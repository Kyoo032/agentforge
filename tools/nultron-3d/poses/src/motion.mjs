// Small helpers for writing clips and loops as sparse keyframes on top of a finished still pose.
export const add = (a, d) => [a[0] + d[0], a[1] + d[1], a[2] + d[2]];
export const mix = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
export const round1 = (a) => a.map((v) => Math.round(v * 10) / 10);

/** Pivot overrides = the still pose's triple plus a delta, for the pivots listed in `deltas`. */
export function nudge(still, deltas) {
  const out = {};
  for (const [name, d] of Object.entries(deltas)) out[name] = round1(add(still.pivots[name], d));
  return out;
}

/** Pivot overrides = a blend from `from` triples to the still pose's, u = 0..1 (u = 1 is the still pose). */
export function blendTo(still, from, u, names) {
  const out = {};
  for (const n of names) out[n] = round1(mix(from[n] ?? [0, 0, 0], still.pivots[n], u));
  return out;
}

export const REST_ARM = { shoulder: [13, 8, 0], elbow: [12, 0, 0], hand: [0, 0, 0] };

/** Rest triples for the arm pivots of a side ("l" | "r"), the idle values used by most states. */
export function restArm(side) {
  return {
    [`shoulder-${side}`]: REST_ARM.shoulder,
    [`elbow-${side}`]: REST_ARM.elbow,
    [`hand-${side}`]: REST_ARM.hand,
  };
}

export const off = (x, y, z) => ({ offset: [x, y, z] });
export const lean = (p, t, r) => ({ lean: [p, t, r] });
