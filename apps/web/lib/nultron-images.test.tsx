import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NultronMascot } from "@/components/nultron/nultron-mascot";
import {
  clipBeats,
  clipMs,
  clipSpec,
  loopSpec,
  manifestFiles,
  NX_BEAT_MS,
  NX_LOOP_FRAMES,
  NX_MANIFEST,
  stillPath,
} from "@/components/nultron/nx-image-manifest";
import { imageUrl, presentImages } from "@/components/nultron/nx-image-urls";
import { MASCOT_STATES, STATE_MOTION } from "./mascot-states";

/**
 * The picture of the character is a set of files replaced by the 3D renders, so the contract that must hold
 * is the manifest and the layout, not the pixels: every state has its body and head still, a `once` state may
 * have a clip whose strip is as wide as its frame count says and lasts 600 to 1200 ms, a working state may
 * have a four-frame loop, and every file is bundled, named by the manifest and the size it declares.
 */

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const imagesDir = join(web, "components", "nultron", "images");
const globals = readFileSync(join(web, "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");

/** Width and height of a PNG (IHDR) or a WebP (VP8, VP8L or VP8X chunk). */
function imageSize(path: string): { width: number; height: number } {
  const b = readFileSync(join(imagesDir, path));
  if (b.toString("latin1", 1, 4) === "PNG") {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8X") {
      return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") {
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
  }
  throw new Error(`${path} is neither a PNG nor a WebP`);
}

const onceStates = MASCOT_STATES.filter((state) => STATE_MOTION[state] === "once");
const busyStates = MASCOT_STATES.filter((state) => STATE_MOTION[state] === "loop-busy");

describe("the picture manifest", () => {
  const manifest = NX_MANIFEST;

  it("names a body and a head still for every state, and nothing that is not one", () => {
    expect(Object.keys(manifest.full.states).sort()).toEqual([...MASCOT_STATES].sort());
    expect(Object.keys(manifest.head.states).sort()).toEqual([...MASCOT_STATES].sort());
    for (const state of MASCOT_STATES) {
      expect(stillPath("full", state), state).toMatch(new RegExp(`^full/${state}\\.(png|webp)$`));
      expect(stillPath("head", state), state).toMatch(new RegExp(`^head/${state}\\.(png|webp)$`));
    }
  });

  it("gives a clip only to a `once` state, lasting 600 to 1200 ms", () => {
    expect(Object.keys(manifest.clips).length).toBeGreaterThan(0);
    for (const state of Object.keys(manifest.clips)) {
      expect(onceStates as readonly string[], `${state} has a clip but is not a once state`).toContain(state);
      const clip = clipSpec(state as (typeof MASCOT_STATES)[number]);
      if (!clip) continue;
      expect(clip.src, state).toMatch(new RegExp(`^clips/${state}\\.(png|webp)$`));
      expect(clip.frames, state).toBeGreaterThanOrEqual(2);
      expect(clipMs(clip), `${state} clip length`).toBeGreaterThanOrEqual(600);
      expect(clipMs(clip), `${state} clip length`).toBeLessThanOrEqual(1200);
      expect(Number.isFinite(clipBeats(clip)), state).toBe(true);
    }
  });

  it("gives a loop only to a working state, and makes it exactly four frames (--ease-busy is steps(4))", () => {
    expect(NX_LOOP_FRAMES).toBe(4);
    for (const state of Object.keys(manifest.loops ?? {})) {
      expect(busyStates as readonly string[], `${state} has a loop but does not work`).toContain(state);
      const loop = loopSpec(state as (typeof MASCOT_STATES)[number]);
      expect(loop?.frames, state).toBe(NX_LOOP_FRAMES);
      expect(loop?.src, state).toMatch(new RegExp(`^loops/${state}\\.(png|webp)$`));
    }
  });

  it("times its clips on the desk's motion beat", () => {
    const token = /--motion-4:\s*(\d+)ms/.exec(globals);
    expect(Number(token?.[1]), "--motion-4 in app/globals.css").toBe(NX_BEAT_MS);
  });

  it("has every file it names, bundled and served, and no file it does not name", () => {
    const present = new Set(presentImages());
    for (const file of manifestFiles()) {
      expect(present.has(file), `${file} is missing under components/nultron/images`).toBe(true);
      expect(imageUrl(file), file).toBeTruthy();
    }
    const named = new Set(manifestFiles());
    const stray = [...present].filter((file) => !named.has(file));
    expect(stray, `files under images/ that the manifest does not name:\n  ${stray.join("\n  ")}`).toEqual([]);
  });

  it("draws every still, clip and loop at the size the manifest declares", () => {
    for (const state of MASCOT_STATES) {
      const full = imageSize(stillPath("full", state) ?? "");
      const head = imageSize(stillPath("head", state) ?? "");
      expect(full, `full/${state}`).toEqual({ width: manifest.full.size, height: manifest.full.size });
      expect(head, `head/${state}`).toEqual({ width: manifest.head.size, height: manifest.head.size });
    }
    for (const [state, clip] of Object.entries(manifest.clips)) {
      expect(imageSize(clip.src), `${state} clip`).toEqual({ width: clip.frames * clip.size, height: clip.size });
    }
    for (const [state, loop] of Object.entries(manifest.loops ?? {})) {
      const size = loop.size ?? manifest.clips.wave?.size ?? manifest.full.size;
      expect(imageSize(loop.src), `${state} loop`).toEqual({ width: loop.frames * size, height: size });
    }
  });

  it("states how many bytes it carries, and the files add up to it", () => {
    if (manifest.bytes === undefined) return;
    const total = manifestFiles().reduce((sum, file) => sum + readFileSync(join(imagesDir, file)).length, 0);
    expect(Math.abs(total - manifest.bytes) / manifest.bytes, `${total} bytes on disk`).toBeLessThan(0.1);
  });
});

describe("NultronMascot draws the picture", () => {
  const html = (props: Parameters<typeof NultronMascot>[0]) => renderToStaticMarkup(<NultronMascot {...props} />);

  it("uses the head still below 64 px and the body from it up", () => {
    expect(html({ state: "idle", size: 40 })).toContain("/head/idle");
    expect(html({ state: "idle", size: 96 })).toContain("/full/idle");
    // the edge itself: 63 px is still a head, 64 px is the first body
    expect(html({ state: "idle", size: 63 })).toContain("/head/idle");
    expect(html({ state: "idle", size: 64 })).toContain("/full/idle");
  });

  it("marks a state that has a clip, on the body only, so the small transform motion steps aside", () => {
    const wave = html({ state: "wave", size: 96 });
    expect(wave).toContain('data-clip="true"');
    expect(wave).toContain('class="nx-strip"');
    expect(wave).toContain("--nx-clip-frames:");
    expect(html({ state: "idle", size: 96 })).not.toContain("nx-strip");
    expect(html({ state: "wave", size: 40 })).not.toContain("nx-strip");
    expect(html({ state: "wave", size: 40 })).not.toContain("data-clip");
  });

  it("keeps every attribute the CSS and the tests read, and is not busy on a still state", () => {
    const hero = html({ state: "idle", variant: "full", busy: true });
    expect(hero).toContain('data-motion="still"');
    expect(hero).toContain('data-variant="full"');
    expect(hero).not.toContain("data-busy");
  });

  it("marks a working state that has a loop, on the body only", () => {
    expect(html({ state: "writing", size: 96, busy: true })).toContain('data-loop="true"');
    expect(html({ state: "writing", size: 96, busy: true })).toContain("--nx-loop-beats:");
    expect(html({ state: "writing", size: 40, busy: true })).not.toContain("data-loop");
  });

  it("is silent to a screen reader when it is decorative", () => {
    const quiet = html({ state: "thinking", decorative: true });
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain('role="img"');
    expect(quiet).not.toContain("aria-label");
    expect(quiet).not.toContain("title=");
    expect(html({ state: "thinking" })).toContain('role="img"');
  });
});
