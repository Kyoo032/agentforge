// Checks a render directory (manifest.json plus full/, head/, clips/, loops/) against the app's contract (app-contract.mjs).
// It restates what apps/web/lib/nultron-images.test.tsx asserts, so a set that passes here passes that test.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { imageInfo } from "./webp.mjs";

/** Every file the manifest names, relative to the directory. */
export function manifestFiles(manifest) {
  return [
    ...Object.values(manifest.full?.states ?? {}),
    ...Object.values(manifest.head?.states ?? {}),
    ...Object.values(manifest.clips ?? {}).map((clip) => clip.src),
    ...Object.values(manifest.loops ?? {}).map((loop) => loop.src),
  ];
}

// The pixel size the manifest declares for a file, as nultron-images.test.tsx computes it.
function expectedSize(manifest, rel) {
  if (rel.startsWith("full/")) return { width: manifest.full.size, height: manifest.full.size };
  if (rel.startsWith("head/")) return { width: manifest.head.size, height: manifest.head.size };
  for (const clip of Object.values(manifest.clips ?? {})) {
    if (clip.src === rel) return { width: clip.frames * clip.size, height: clip.size };
  }
  for (const loop of Object.values(manifest.loops ?? {})) {
    if (loop.src === rel) {
      const size = loop.size ?? manifest.clips?.wave?.size ?? manifest.full.size;
      return { width: loop.frames * size, height: size };
    }
  }
  return null;
}

function checkStills(manifest, contract, errors) {
  for (const kind of ["full", "head"]) {
    const part = manifest[kind];
    if (!part || typeof part.size !== "number" || typeof part.states !== "object") {
      errors.push(`manifest.${kind} needs { size, states }`);
      continue;
    }
    const named = Object.keys(part.states);
    for (const s of contract.states.filter((x) => !named.includes(x))) errors.push(`${kind}: no still for state "${s}"`);
    for (const s of named.filter((x) => !contract.states.includes(x))) {
      errors.push(`${kind}: "${s}" is not a mascot state in mascot-states.ts`);
    }
    for (const [state, rel] of Object.entries(part.states)) {
      if (!new RegExp(`^${kind}/${state}\\.(png|webp)$`).test(rel)) {
        errors.push(`${kind}/${state}: path "${rel}" is not ${kind}/${state}.webp`);
      }
    }
  }
}

function checkClips(manifest, contract, errors, warnings) {
  const clips = manifest.clips ?? {};
  for (const [state, clip] of Object.entries(clips)) {
    if (!contract.onceStates.includes(state)) errors.push(`clips: "${state}" has a clip but is not a "once" state`);
    if (!(clip.frames >= 2) || !(clip.fps > 0) || !(clip.size > 0)) {
      errors.push(`clips/${state}: needs frames >= 2, fps and size`);
    }
    const ms = (clip.frames / clip.fps) * 1000;
    if (ms < contract.clipMs.min || ms > contract.clipMs.max) {
      errors.push(`clips/${state}: ${Math.round(ms)} ms, must be ${contract.clipMs.min} to ${contract.clipMs.max}`);
    }
    if (!new RegExp(`^clips/${state}\\.(png|webp)$`).test(clip.src)) errors.push(`clips/${state}: path "${clip.src}"`);
  }
  for (const state of contract.onceStates.filter((s) => !clips[s])) {
    warnings.push(`clips: "${state}" is a "once" state with no clip (the app falls back to a transform)`);
  }
}

function checkLoops(manifest, contract, errors, warnings) {
  const loops = manifest.loops ?? {};
  for (const [state, loop] of Object.entries(loops)) {
    if (!contract.busyStates.includes(state)) errors.push(`loops: "${state}" has a loop but is not a "loop-busy" state`);
    if (loop.frames !== contract.loopFrames) {
      errors.push(`loops/${state}: ${loop.frames} frames, must be exactly ${contract.loopFrames} (--ease-busy is steps(4))`);
    }
    if (!new RegExp(`^loops/${state}\\.(png|webp)$`).test(loop.src)) errors.push(`loops/${state}: path "${loop.src}"`);
  }
  for (const state of contract.busyStates.filter((s) => !loops[s])) {
    warnings.push(`loops: "${state}" is a "loop-busy" state with no loop (the app falls back to a transform)`);
  }
}

function checkFiles(dir, manifest, errors) {
  const files = manifestFiles(manifest);
  let bytes = 0;
  for (const rel of files) {
    const abs = join(dir, rel);
    if (!existsSync(abs)) {
      errors.push(`missing file ${rel}`);
      continue;
    }
    const data = readFileSync(abs);
    bytes += data.length;
    const info = imageInfo(data);
    if (!info) {
      errors.push(`${rel} is neither a PNG nor a WebP`);
      continue;
    }
    if (!info.alpha) errors.push(`${rel} has no alpha channel (the character stands on a transparent background)`);
    const want = expectedSize(manifest, rel);
    if (want && (info.width !== want.width || info.height !== want.height)) {
      errors.push(`${rel} is ${info.width}x${info.height}, manifest says ${want.width}x${want.height}`);
    }
  }
  if (typeof manifest.bytes === "number" && manifest.bytes !== bytes) {
    errors.push(`manifest.bytes is ${manifest.bytes} but the files add up to ${bytes}`);
  }
  return { files, bytes };
}

/** { errors, warnings, files, bytes, manifest } for the manifest in `dir`. An error means the app's test would fail. */
export function checkImageSet(dir, contract) {
  const errors = [];
  const warnings = [];
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return { errors: [`${manifestPath} does not exist`], warnings, files: [], bytes: 0 };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return { errors: [`manifest.json is not JSON: ${err.message}`], warnings, files: [], bytes: 0 };
  }
  if (typeof manifest.version !== "number") errors.push("manifest.version must be a number");
  checkStills(manifest, contract, errors);
  checkClips(manifest, contract, errors, warnings);
  checkLoops(manifest, contract, errors, warnings);
  if (contract.beatMs !== contract.motionToken) {
    errors.push(`NX_BEAT_MS (${contract.beatMs}) is not --motion-4 (${contract.motionToken}ms) in globals.css`);
  }
  const { files, bytes } = checkFiles(dir, manifest, errors);
  return { errors, warnings, files, bytes, manifest };
}
