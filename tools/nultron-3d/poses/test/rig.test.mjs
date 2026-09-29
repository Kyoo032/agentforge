// Rig tests: node --test poses/test/rig.test.mjs   (run from the workspace root)
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNultron } from "../../character.js";
import { PROPS } from "../../props.js";
import {
  ATTACH,
  EYES,
  HANDS,
  MOUTHS,
  OPTIONAL_EYES,
  PIVOT_NAMES,
  POSES,
  STATE_NAMES,
  applyPose,
  evaluatePose,
  poseDuration,
} from "../../rig.js";

const CONTRACT_STATES = [
  "idle", "wave", "thinking", "writing", "answering", "searching", "calculating", "charting", "reviewing", "listening",
  "painting", "filming", "editing", "presenting", "celebrating", "error", "sleep", "surprised", "love", "charging", "lets-go",
];
const ONE_SHOTS = ["wave", "celebrating", "error", "surprised", "love", "lets-go"];
const BUILTIN_PROPS = ["tear", "heart-mini"];

const r6 = (n) => Math.round(n * 1e6) / 1e6 + 0;
function nodePath(o) {
  const names = [];
  for (let p = o; p; p = p.parent) names.push(p.name || p.type);
  return names.reverse().join("/");
}
/** Everything the rig is allowed to change: transform, visibility and parent of every node in the graph. */
function snapshot(root) {
  const rows = [];
  root.traverse((o) => {
    rows.push([nodePath(o), o.visible, ...o.position.toArray().map(r6), ...o.quaternion.toArray().map(r6), ...o.scale.toArray().map(r6)]);
  });
  return JSON.stringify(rows);
}

test("the state list is exactly the contract's 21", () => {
  assert.deepEqual([...STATE_NAMES].sort(), [...CONTRACT_STATES].sort());
});

test("every state names valid variants, props, attach points and fx", () => {
  for (const [name, s] of Object.entries(POSES.states)) {
    assert.ok([...EYES, ...Object.keys(OPTIONAL_EYES)].includes(s.eyes), `${name}: eyes ${s.eyes}`);
    assert.ok(MOUTHS.includes(s.mouth), `${name}: mouth ${s.mouth}`);
    assert.ok(HANDS.includes(s.handL), `${name}: handL ${s.handL}`);
    assert.ok(HANDS.includes(s.handR), `${name}: handR ${s.handR}`);
    for (const p of PIVOT_NAMES) {
      const v = s.pivots[p];
      assert.ok(Array.isArray(v) && v.length === 3 && v.every(Number.isFinite), `${name}: pivot ${p} = ${JSON.stringify(v)}`);
    }
    for (const spec of [].concat(s.prop ?? [])) {
      assert.ok(ATTACH.includes(spec.attach), `${name}: attach ${spec.attach}`);
      assert.ok(spec.name in PROPS || BUILTIN_PROPS.includes(spec.name), `${name}: prop ${spec.name}`);
    }
    for (const spec of s.fx ?? []) {
      assert.ok(spec.name in PROPS || BUILTIN_PROPS.includes(spec.name), `${name}: fx ${spec.name}`);
      assert.ok(Array.isArray(spec.pos) && spec.pos.length === 3, `${name}: fx ${spec.name} pos`);
    }
  }
});

test("applying every state warns about nothing and shows exactly one variant per group", () => {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(" "));
  try {
    const root = buildNultron();
    for (const state of STATE_NAMES) {
      applyPose(root, state);
      const one = (group, prefix) => root.getObjectByName(group).children.filter((c) => c.name.startsWith(prefix) && c.visible).length;
      assert.equal(one("nx-eyes", "nx-eyes-"), 1, `${state}: eyes`);
      assert.equal(one("nx-mouth", "nx-mouth-"), 1, `${state}: mouth`);
      assert.equal(one("nx-hand-l", "nx-hand-l-"), 1, `${state}: hand-l`);
      assert.equal(one("nx-hand-r", "nx-hand-r-"), 1, `${state}: hand-r`);
    }
  } finally {
    console.warn = orig;
  }
  assert.deepEqual(warnings, []);
});

test("idempotent: any pose applied after any other equals that pose on a fresh model", () => {
  const fresh = {};
  for (const state of STATE_NAMES) {
    const m = buildNultron();
    applyPose(m, state);
    fresh[state] = snapshot(m);
  }
  const root = buildNultron();
  for (const a of STATE_NAMES) {
    for (const b of STATE_NAMES) {
      applyPose(root, a);
      applyPose(root, b);
      assert.equal(snapshot(root), fresh[b], `${a} -> ${b}`);
    }
  }
});

test("idempotent across clip times: a mid-clip pose then a still pose gives the still pose", () => {
  const root = buildNultron();
  const m = buildNultron();
  for (const state of STATE_NAMES) {
    applyPose(m, state);
    const want = snapshot(m);
    for (const t of [0, 0.2, 0.45, 0.8]) {
      applyPose(root, state, { t, mode: "loop" });
      applyPose(root, state, { t });
      applyPose(root, "idle", { t });
      applyPose(root, state);
      assert.equal(snapshot(root), want, `${state} after t=${t}`);
    }
  }
});

test("one-shot clips: 12 fps, at most 1.2 s, increasing frames, and they end exactly on the still pose", () => {
  for (const state of ONE_SHOTS) {
    const clip = POSES.states[state].clip;
    assert.ok(clip, `${state} has a clip`);
    assert.equal(clip.fps, 12);
    const fs = clip.frames.map((k) => k.f);
    assert.ok(fs.every((f, i) => i === 0 || f > fs[i - 1]), `${state}: frames increase`);
    assert.ok(poseDuration(state) <= 1.2 + 1e-9, `${state}: ${poseDuration(state)} s`);
    const last = clip.frames[clip.frames.length - 1];
    assert.deepEqual(Object.keys(last).filter((k) => k !== "f"), [], `${state}: last keyframe carries no overrides`);
    const still = evaluatePose(state);
    for (const t of [poseDuration(state), poseDuration(state) + 0.5]) {
      const end = evaluatePose(state, { t });
      assert.deepEqual({ ...end, fxFrame: 0 }, { ...still, fxFrame: 0 }, `${state} at t=${t}`);
    }
  }
});

test("clips and loops evaluate to finite angles with no jump above 120 degrees per frame (peak of an ease-out)", () => {
  for (const state of STATE_NAMES) {
    for (const mode of ["clip", "loop"]) {
      const def = POSES.states[state];
      if (!def[mode]) continue;
      const fps = def[mode].fps;
      const dur = mode === "clip" ? poseDuration(state) : def.loop.frames.length / fps;
      let prev = null;
      for (let t = 0; t <= dur + 1e-9; t += 1 / 48) {
        const p = evaluatePose(state, { t, mode });
        for (const n of PIVOT_NAMES) {
          assert.ok(p.pivots[n].every(Number.isFinite), `${state}/${mode}/${n} at ${t}`);
          if (prev) {
            const d = Math.max(...p.pivots[n].map((v, i) => Math.abs(v - prev.pivots[n][i])));
            assert.ok(d < 120 / 4, `${state}/${mode}/${n}: ${d.toFixed(1)} deg in a quarter frame at t=${t.toFixed(2)}`);
          }
        }
        prev = p;
      }
    }
  }
});

test("loops are 4 frames and wrap: t and t + period give the same pose", () => {
  for (const state of STATE_NAMES) {
    const loop = POSES.states[state].loop;
    if (!loop) continue;
    assert.equal(loop.frames.length, 4, `${state}: 4 frames`);
    const period = 4 / loop.fps;
    const a = evaluatePose(state, { t: 0.13, mode: "loop" });
    const b = evaluatePose(state, { t: 0.13 + period, mode: "loop" });
    for (const n of PIVOT_NAMES) {
      for (const [i, v] of a.pivots[n].entries()) assert.ok(Math.abs(v - b.pivots[n][i]) < 1e-6, `${state}: ${n} wraps`);
    }
  }
});

test("an unknown state throws", () => {
  const root = buildNultron();
  assert.throws(() => applyPose(root, "nope"), /unknown state/);
});
