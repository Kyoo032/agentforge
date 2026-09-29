// Generates ../poses.json. Arm poses are described as world-space targets (where the grip point goes, which way a hand
// axis points, where the elbow leans) and solved against the REAL model's arm lengths by tools/kin.mjs, so a change to
// layout.js (arm length, shoulder height) is one re-run away:   node poses/build-poses.mjs
// Everything else (head, legs, body, variants, props, fx, clips, loops) is authored here as plain numbers.
// The rig's angle conventions are in rig.js's header. Hand-editing poses.json works too, but the next run overwrites it.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel, solveArm } from "./tools/kin.mjs";
import { STATES } from "./src/states.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = loadModel();
const report = [];

function solveSide(state, side, spec) {
  if (spec.raw) return spec.raw;
  const r = solveArm(root, side, { ...spec, body: spec.body });
  report.push({ state, side, err: +r.err.toFixed(4), aim: r.aimErr.map((a) => +a.toFixed(1)), clamped: r.clamped, elbow: r.E.toArray().map((v) => +v.toFixed(2)) });
  return { shoulder: r.shoulder, elbow: r.elbow, hand: r.hand };
}

/** Turns a state description into poses.json's shape. */
function finish(name, s) {
  const pivots = { neck: s.neck ?? [0, 0, 0], antenna: s.antenna ?? [0, 0, 0] };
  const arms = s.arms ?? {};
  for (const side of ["l", "r"]) {
    const spec = arms[side] ?? { raw: { shoulder: [13, 8, 0], elbow: [12, 0, 0], hand: [0, 0, 0] } };
    const withBody = spec.raw ? spec : { ...spec, body: s.body };
    const a = solveSide(name, side, withBody);
    pivots[`shoulder-${side}`] = a.shoulder;
    pivots[`elbow-${side}`] = a.elbow;
    pivots[`hand-${side}`] = a.hand;
  }
  const legs = s.legs ?? {};
  pivots["hip-l"] = legs.l ?? [0, 2, 0];
  pivots["hip-r"] = legs.r ?? [0, 2, 0];
  const out = {
    note: s.note,
    pivots,
    body: { offset: s.body?.offset ?? [0, 0, 0], lean: s.body?.lean ?? [0, 0, 0] },
    eyes: s.eyes ?? "open",
    mouth: s.mouth ?? "idle",
    handL: s.handL ?? "fist",
    handR: s.handR ?? "fist",
    prop: s.prop ?? null,
    fx: s.fx ?? [],
  };
  if (s.clip) out.clip = { fps: 12, frames: s.clip(out) };
  if (s.loop) out.loop = { fps: s.loopFps ?? 4, frames: s.loop(out) };
  return out;
}

const states = {};
for (const [name, def] of Object.entries(STATES)) states[name] = finish(name, def);

const meta = {
  version: 1,
  generatedBy: "poses/build-poses.mjs (edit poses/src/states.mjs, then re-run)",
  units: "1 unit = half the body height; angles in degrees; left/right are screen-relative",
  conventions: "see the header of rig.js",
  clipFps: 12,
  states: Object.keys(states),
};
writeFileSync(join(here, "..", "poses.json"), `${fmt({ _meta: meta, states })}\n`);
console.log(`poses.json: ${Object.keys(states).length} states`);
const bad = report.filter((r) => r.err > 0.012 || r.aim.some((a) => a > 12));
for (const r of report) console.log(`  ik ${r.state.padEnd(12)} ${r.side} err ${r.err} aim ${r.aim.join(",")}${r.clamped ? `  CLAMPED (wanted ${r.clamped.wanted}, reach ${r.clamped.reach})` : ""}${bad.includes(r) ? "  <-- check" : ""}`);

/** Compact JSON: every array of numbers on one line, one key per line otherwise. */
function fmt(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "number" || typeof v === "string")) return JSON.stringify(value);
    return `[\n${value.map((v) => `${pad}  ${fmt(v, indent + 1)}`).join(",\n")}\n${pad}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    const flat = entries.every(([, v]) => v === null || typeof v !== "object" || (Array.isArray(v) && v.every((x) => typeof x === "number" || typeof x === "string")));
    const inline = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${fmt(v, 0)}`).join(", ")} }`;
    if (flat && inline.length < 110) return inline;
    return `{\n${entries.map(([k, v]) => `${pad}  ${JSON.stringify(k)}: ${fmt(v, indent + 1)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}
