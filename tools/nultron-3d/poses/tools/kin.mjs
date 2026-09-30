// Poser's kinematics helpers (authoring time only): forward kinematics of the arms read from the real model's graph,
// and a numeric IK that turns "put this grip point HERE, aim this hand axis THERE" into the rig's angle triples.
// Not shipped, not imported by rig.js.
import * as THREE from "three";
import { buildNultron } from "../../character.js";
import { flexQuat, headQuat, shoulderQuat } from "../../rig.js";

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

export function loadModel() {
  const root = buildNultron();
  root.updateMatrixWorld(true);
  return root;
}

const worldOf = (root, name) => root.getObjectByName(name).getWorldPosition(V());

/** Arm geometry at rest, side "r" (viewer's right). The left arm is the mirror image (x negated). */
export function armData(root, side = "r") {
  const body = worldOf(root, "nx-body");
  const S = worldOf(root, `nx-shoulder-${side}`);
  const E = worldOf(root, `nx-elbow-${side}`);
  const W = worldOf(root, `nx-hand-${side}`);
  const hand = root.getObjectByName(`nx-hand-${side}`);
  const grips = Object.fromEntries(Object.entries(hand.userData.grips ?? {}).map(([k, g]) => [k, V(...g)]));
  return { body, shoulderRel: S.clone().sub(body), o1: E.clone().sub(S), o2: W.clone().sub(E), grips, side };
}

/** Arm data for either side, read from the model itself (both sides are real nodes). */
export function armFor(root, side) {
  return armData(root, side);
}

/**
 * Forward kinematics. Params are the rig triples. Returns world positions and the hand frame's quaternion.
 * lean/offset are the body's (leaning rotates the whole arm chain about the hip centre).
 */
export function armFK(arm, side, { shoulder, elbow, hand }, gripName = "fist", body = {}) {
  const off = V(...(body.offset ?? [0, 0, 0]));
  const Qb = headQuat(body.lean ?? [0, 0, 0]);
  const S = arm.body.clone().add(off).add(arm.shoulderRel.clone().applyQuaternion(Qb));
  const Q1 = Qb.clone().multiply(shoulderQuat(side, shoulder));
  const E = S.clone().add(arm.o1.clone().applyQuaternion(Q1));
  const Q2 = Q1.clone().multiply(flexQuat(side, elbow));
  const W = E.clone().add(arm.o2.clone().applyQuaternion(Q2));
  const Q3 = Q2.clone().multiply(flexQuat(side, hand));
  const G = W.clone().add((arm.grips[gripName] ?? V()).clone().applyQuaternion(Q3));
  return { S, E, W, G, Q1, Q2, Q3 };
}

// ---------------------------------------------------------------------------------------------------------------------
// IK (Levenberg-Marquardt on a residual vector, numeric Jacobian, multi-start)
// ---------------------------------------------------------------------------------------------------------------------

const LIMITS = [
  [0, 180], // shoulder elev
  [-120, 150], // azim
  [-180, 180], // twist
  [0, 150], // elbow flex
  [-75, 70], // wrist flex
  [-35, 35], // wrist inward
  [-100, 100], // wrist roll
];

function unpack(x) {
  return { shoulder: [x[0], x[1], x[2]], elbow: [x[3], 0, 0], hand: [x[4], x[5], x[6]] };
}

/**
 * @param {object} spec
 *   grip    [x,y,z] target of the grip point (world)
 *   gripName hand variant whose grip point is used ("fist" | "hold" | ...)
 *   aims    [{ local:[x,y,z], world:[x,y,z], w }] hand-frame axis (right-hand frame; x is mirrored for "l") -> world direction
 *   pole    [x,y,z] optional world point the elbow should lean toward (soft, weight polew)
 *   wristFree number 0..1 how freely the wrist may deviate (0 keeps it straight)
 *   body    { offset, lean }
 * @returns {{ shoulder, elbow, hand, err, G, E }}
 */
export function solveArm(root, side, spec) {
  const arm = armFor(root, side);
  const sx = side === "l" ? -1 : 1;
  const gripName = spec.gripName ?? "fist";
  const tgt = V(...spec.grip);
  const shoulderWorld = arm.body
    .clone()
    .add(V(...(spec.body?.offset ?? [0, 0, 0])))
    .add(arm.shoulderRel.clone().applyQuaternion(headQuat(spec.body?.lean ?? [0, 0, 0])));
  const reach = arm.o1.length() + arm.o2.clone().add(arm.grips[gripName] ?? V()).length();
  const wanted = shoulderWorld.distanceTo(tgt);
  let clamped = null;
  if (wanted > reach * 0.96) {
    clamped = { wanted: +wanted.toFixed(3), reach: +reach.toFixed(3) };
    const dir = tgt.clone().sub(shoulderWorld).setLength(reach * 0.96);
    tgt.copy(shoulderWorld).add(dir);
  }
  const aims = (spec.aims ?? []).map((a) => ({
    // Right-hand descriptions are mirrored for the left hand; { raw: true } axes are already in the actual hand frame.
    local: a.raw ? V(...a.local).normalize() : V(...a.local).multiply(V(sx, 1, 1)).normalize(),
    world: V(...a.world).normalize(),
    w: a.w ?? 0.3,
  }));
  const pole = spec.pole ? V(...spec.pole) : null;
  const polew = spec.polew ?? 0.08;
  const wreg = 0.004 * (1 - (spec.wristFree ?? 0.3) * 0.9);
  // The hand-frame axes of the left hand are given already mirrored by the caller's "local" convention: for "l" the
  // local x sign is flipped above so a right-hand description carries over unchanged.
  const residual = (x) => {
    const p = unpack(x);
    const fk = armFK(arm, side, p, gripName, spec.body);
    const r = [];
    const e = fk.G.clone().sub(tgt);
    r.push(e.x * 1000, e.y * 1000, e.z * 1000);
    for (const a of aims) {
      const d = a.local.clone().applyQuaternion(fk.Q3).sub(a.world);
      r.push(d.x * a.w * 40, d.y * a.w * 40, d.z * a.w * 40);
    }
    if (pole) {
      const d = fk.E.clone().sub(pole);
      r.push(d.x * polew * 100, d.y * polew * 100, d.z * polew * 100);
    }
    r.push(x[4] * wreg * 100, x[5] * wreg * 100, x[6] * wreg * 100);
    // gentle preference against twist far from zero
    r.push(x[2] * 0.0008 * 100);
    // Always push one entry per limit (0 when inactive): the residual vector must keep its length for the Jacobian.
    LIMITS.forEach(([lo, hi], i) => {
      r.push(x[i] < lo ? (lo - x[i]) * 2 : x[i] > hi ? (x[i] - hi) * 2 : 0);
    });
    return r;
  };
  const cost = (r) => r.reduce((s, v) => s + v * v, 0);

  const lm = (x0) => {
    let x = x0.slice();
    let r = residual(x);
    let c = cost(r);
    let lambda = 1;
    for (let it = 0; it < 200; it++) {
      const n = x.length;
      const J = [];
      for (let j = 0; j < n; j++) {
        const xp = x.slice();
        xp[j] += 0.05;
        const rp = residual(xp);
        J.push(rp.map((v, i) => (v - r[i]) / 0.05));
      }
      // normal equations (J^T J + lambda I) dx = -J^T r
      const A = Array.from({ length: n }, () => new Array(n).fill(0));
      const g = new Array(n).fill(0);
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) for (let i = 0; i < r.length; i++) A[a][b] += J[a][i] * J[b][i];
        for (let i = 0; i < r.length; i++) g[a] -= J[a][i] * r[i];
      }
      let improved = false;
      for (let tries = 0; tries < 20; tries++) {
        const M = A.map((row, i) => row.map((v, j) => v + (i === j ? lambda * (A[i][i] + 1e-6) : 0)));
        const dx = solveLinear(M, g);
        if (!dx) {
          lambda *= 10;
          continue;
        }
        const xn = x.map((v, i) => v + Math.max(-12, Math.min(12, dx[i])));
        const rn = residual(xn);
        const cn = cost(rn);
        if (cn < c) {
          x = xn;
          r = rn;
          c = cn;
          lambda = Math.max(1e-4, lambda / 3);
          improved = true;
          break;
        }
        lambda *= 5;
      }
      if (!improved) break;
    }
    return { x, c };
  };

  let best = null;
  let seed = spec.seed ?? 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const starts = spec.starts ?? 80;
  // Analytic elbow flex for the target distance (law of cosines), so no start begins on the flex = 0 saddle.
  const L1 = arm.o1.length();
  const L2 = arm.o2.clone().add(arm.grips[gripName] ?? V()).length();
  const d = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, shoulderWorld.distanceTo(tgt)));
  const flex0 = Math.acos(Math.max(-1, Math.min(1, (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)))) / DEG;
  for (let s = 0; s < starts; s++) {
    const x0 = [
      rnd() * 170 + 5,
      rnd() * 200 - 60,
      rnd() * 360 - 180,
      Math.max(3, flex0 + (rnd() - 0.5) * 30),
      rnd() * 20 - 10,
      rnd() * 10 - 5,
      rnd() * 40 - 20,
    ];
    const res = lm(x0);
    if (!best || res.c < best.c) best = res;
  }
  const p = unpack(best.x);
  const fk = armFK(arm, side, p, gripName, spec.body);
  const round = (a) => a.map((v) => Math.round(v * 10) / 10 + 0);
  return {
    shoulder: round(p.shoulder),
    elbow: round(p.elbow),
    hand: round(p.hand),
    err: fk.G.distanceTo(tgt),
    aimErr: aims.map((a) => a.local.clone().applyQuaternion(fk.Q3).angleTo(a.world) / DEG),
    G: fk.G,
    E: fk.E,
    W: fk.W,
    fk,
    cost: best.c,
    clamped,
    target: tgt.toArray().map((v) => +v.toFixed(3)),
    reach,
  };
}

function solveLinear(M, b) {
  const n = b.length;
  const A = M.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    if (Math.abs(A[p][i]) < 1e-12) return null;
    [A[i], A[p]] = [A[p], A[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x;
}
