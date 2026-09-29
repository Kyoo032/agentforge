// What the app expects of a mascot image set, read from the app's own source so this folder never keeps a second copy of it:
//   apps/web/lib/mascot-states.ts                       MASCOT_STATES and STATE_MOTION (which state may have a clip or a loop)
//   apps/web/components/nultron/nx-image-manifest.ts    NX_BEAT_MS, NX_LOOP_FRAMES and the manifest's shape
//   apps/web/app/globals.css                            --motion-4, which NX_BEAT_MS must equal
// The parsing is deliberately literal (one regex per constant); a change of shape in those files fails loudly here.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (root, rel) => readFileSync(join(root, rel), "utf8").replace(/\r\n/g, "\n");

function need(match, what) {
  if (!match) throw new Error(`app contract: could not find ${what}; has the source changed shape?`);
  return match;
}

/** { states, motion, onceStates, busyStates, beatMs, loopFrames, motionToken, clipMs } for the checkout at `repoRoot`. */
export function readAppContract(repoRoot) {
  const statesTs = read(repoRoot, "apps/web/lib/mascot-states.ts");
  const manifestTs = read(repoRoot, "apps/web/components/nultron/nx-image-manifest.ts");
  const css = read(repoRoot, "apps/web/app/globals.css");

  const list = need(/export const MASCOT_STATES = \[([\s\S]*?)\] as const/.exec(statesTs), "MASCOT_STATES")[1];
  const states = [...list.matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
  const block = need(/export const STATE_MOTION[^=]*= \{([\s\S]*?)\n\};/.exec(statesTs), "STATE_MOTION")[1];
  const motion = Object.fromEntries(
    [...block.matchAll(/^\s*"?([\w-]+)"?:\s*"(still|once|loop-busy)"/gm)].map((m) => [m[1], m[2]]),
  );
  const missing = states.filter((s) => !motion[s]);
  if (states.length === 0 || missing.length) {
    throw new Error(`app contract: STATE_MOTION lacks ${missing.join(", ") || "all states"}`);
  }

  return {
    states,
    motion,
    onceStates: states.filter((s) => motion[s] === "once"),
    busyStates: states.filter((s) => motion[s] === "loop-busy"),
    beatMs: Number(need(/export const NX_BEAT_MS = (\d+)/.exec(manifestTs), "NX_BEAT_MS")[1]),
    loopFrames: Number(need(/export const NX_LOOP_FRAMES = (\d+)/.exec(manifestTs), "NX_LOOP_FRAMES")[1]),
    motionToken: Number(need(/--motion-4:\s*(\d+)ms/.exec(css), "--motion-4 in globals.css")[1]),
    clipMs: { min: 600, max: 1200 }, // nultron-images.test.tsx: "lasting 600 to 1200 ms"
  };
}
