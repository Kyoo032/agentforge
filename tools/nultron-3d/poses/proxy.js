// PROXY Nultron: capsules and spheres on the contract's scene graph, sized from the 2D FULL rig (conventions.md) at
// 0.012422 units per 2D unit, so the body is ~2.0 units to the top of the helmet. Only for posing before character.js
// exists; the poses are re-fitted on the real model afterwards. Not shipped.
import * as THREE from "three";

const C = {
  blue: 0x2688c8,
  blueDeep: 0x15559a,
  face: 0xf6e7d6,
  white: 0xf8f2e8,
  joint: 0x232427,
  eye: 0x212220,
  glow: 0x38c6de,
  glowSoft: 0xacefef,
  blush: 0xf4a3a3,
};
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...extra });
const M = {
  blue: std(C.blue),
  blueDeep: std(C.blueDeep),
  face: std(C.face),
  white: std(C.white),
  joint: std(C.joint),
  eye: std(C.eye, { roughness: 0.2 }),
  glow: std(C.glow, { emissive: C.glow, emissiveIntensity: 0.6 }),
  blush: std(C.blush),
};

export const PROXY_DIMS = {
  bodyY: 0.4224, // hip centre height
  neckY: 0.56, // neck pivot above the hip centre
  headCentre: 0.51, // helmet centre above the neck pivot
  helmet: [0.62, 0.51, 0.56],
  shoulderX: 0.385,
  shoulderY: 0.42, // above the hip centre
  upperArm: 0.186,
  forearm: 0.149,
  hand: 0.075, // wrist to grip point
  mittRadius: 0.085,
  hipX: 0.199,
};

const named = (o, name) => {
  o.name = name;
  return o;
};
const group = (name, x = 0, y = 0, z = 0) => named(new THREE.Group(), name).translateX(x).translateY(y).translateZ(z);
const ellipsoid = (r, sx, sy, sz, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 20), mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
};
const capsuleDown = (radius, length, mat) => {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - 2 * radius), 8, 20), mat);
  m.position.y = -length / 2;
  return m;
};

function badgeTexture() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#F8F2E8";
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2688C8";
  g.font = "bold 84px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("N", 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function arcMesh(radius, arcDeg, tube, mat, rotZDeg) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, 24, arcDeg * (Math.PI / 180)), mat);
  m.rotation.z = rotZDeg * (Math.PI / 180);
  return m;
}

function buildEyes() {
  const eyes = group("nx-eyes");
  const mk = (name, build) => {
    const g = group(name);
    for (const sx of [-1, 1]) g.add(build(sx));
    eyes.add(g);
  };
  const at = (o, x, y = -0.08, z = 0.55) => {
    o.position.set(x, y, z);
    return o;
  };
  mk("nx-eyes-open", (sx) => at(ellipsoid(1, 0.085, 0.11, 0.035, M.eye), sx * 0.19));
  mk("nx-eyes-blink", (sx) => at(ellipsoid(1, 0.09, 0.012, 0.03, M.eye), sx * 0.19));
  mk("nx-eyes-happy", (sx) => at(arcMesh(0.075, 180, 0.018, M.eye, 0), sx * 0.19, -0.1));
  mk("nx-eyes-surprised", (sx) => at(ellipsoid(1, 0.105, 0.135, 0.035, M.eye), sx * 0.19));
  mk("nx-eyes-closed", (sx) => at(arcMesh(0.075, 180, 0.016, M.eye, 180), sx * 0.19, -0.05));
  return eyes;
}

function buildMouth() {
  const mouth = group("nx-mouth");
  const add = (name, o) => {
    const g = group(name);
    g.add(o);
    g.position.set(0, -0.22, 0.545);
    mouth.add(g);
  };
  add("nx-mouth-idle", arcMesh(0.06, 140, 0.013, M.eye, 200));
  add("nx-mouth-talk", ellipsoid(1, 0.05, 0.035, 0.02, M.eye));
  add("nx-mouth-smile", arcMesh(0.09, 150, 0.015, M.eye, 195));
  add("nx-mouth-sad", arcMesh(0.07, 140, 0.014, M.eye, 20));
  add("nx-mouth-o", ellipsoid(1, 0.04, 0.055, 0.02, M.eye));
  add("nx-mouth-sleep", ellipsoid(1, 0.035, 0.012, 0.02, M.eye));
  return mouth;
}

function buildHand(side) {
  const d = PROXY_DIMS;
  const hand = group(`nx-hand-${side}`);
  const r = d.mittRadius;
  const base = () => ellipsoid(r, 1, 0.9, 0.95, M.blue, 0, -d.hand, 0);
  const variants = {
    fist: () => [base()],
    hold: () => {
      const g = [base()];
      const thumb = ellipsoid(0.035, 1, 1.4, 1, M.blueDeep, 0, -d.hand + 0.06, 0.06);
      g.push(thumb);
      return g;
    },
    open: () => {
      const palm = ellipsoid(r, 1.1, 0.5, 0.6, M.blue, 0, -d.hand - 0.03, 0);
      const fingers = ellipsoid(0.06, 1.4, 1.2, 0.5, M.blue, 0, -d.hand - 0.13, 0);
      const thumb = ellipsoid(0.03, 1, 1.6, 1, M.blue, side === "l" ? 0.1 : -0.1, -d.hand - 0.01, 0);
      return [palm, fingers, thumb];
    },
    point: () => [base(), ellipsoid(0.028, 1, 3.6, 1, M.blue, 0, -d.hand - 0.13, 0.02)],
    thumb: () => [base(), ellipsoid(0.04, 1, 2.2, 1, M.blue, 0, -d.hand - 0.11, 0)],
  };
  for (const [name, build] of Object.entries(variants)) {
    const g = group(`nx-hand-${side}-${name}`);
    for (const m of build()) g.add(m);
    hand.add(g);
  }
  hand.add(group(`nx-grip-${side}`, 0, -d.hand, 0));
  return hand;
}

function buildArm(side) {
  const d = PROXY_DIMS;
  const sx = side === "l" ? -1 : 1;
  const shoulder = group(`nx-shoulder-${side}`, sx * d.shoulderX, d.shoulderY, 0);
  shoulder.add(ellipsoid(0.085, 1, 1, 1, M.joint));
  const upper = named(capsuleDown(0.082, d.upperArm + 0.06, M.blue), `nx-upperarm-${side}`);
  shoulder.add(upper);
  const elbow = group(`nx-elbow-${side}`, 0, -d.upperArm, 0);
  elbow.add(ellipsoid(0.06, 1, 1, 1, M.joint));
  elbow.add(named(capsuleDown(0.078, d.forearm + 0.05, M.blue), `nx-forearm-${side}`));
  const hand = buildHand(side);
  hand.position.set(0, -d.forearm, 0);
  elbow.add(hand);
  shoulder.add(elbow);
  return shoulder;
}

function buildLeg(side) {
  const d = PROXY_DIMS;
  const sx = side === "l" ? -1 : 1;
  const hip = group(`nx-hip-${side}`, sx * d.hipX, 0, 0);
  hip.add(ellipsoid(0.095, 1, 1, 1, M.joint));
  const leg = named(new THREE.Group(), `nx-leg-${side}`);
  const cap = capsuleDown(0.1, 0.27, M.blue);
  leg.add(cap);
  const foot = named(ellipsoid(1, 0.145, 0.095, 0.185, M.blue, 0, -d.bodyY + 0.095, 0.03), `nx-foot-${side}`);
  leg.add(foot);
  hip.add(leg);
  return hip;
}

function buildHead() {
  const d = PROXY_DIMS;
  const neck = group("nx-neck", 0, d.neckY, 0);
  const head = group("nx-head", 0, d.headCentre, 0);
  const [hx, hy, hz] = d.helmet;
  head.add(named(ellipsoid(1, hx, hy, hz, M.blue), "nx-helmet"));
  head.add(named(ellipsoid(1, 0.51, 0.3, 0.25, M.face, 0, -0.1, 0.33), "nx-faceplate"));
  head.add(named(ellipsoid(1, 0.08, 0.145, 0.145, M.blueDeep, -0.658, -0.05, 0), "nx-ear-l"));
  head.add(named(ellipsoid(1, 0.08, 0.145, 0.145, M.blueDeep, 0.658, -0.05, 0), "nx-ear-r"));
  head.add(named(ellipsoid(1, 0.14, 0.14, 0.06, M.glow, 0, 0.24, 0.49), "nx-gem"));
  head.add(named(ellipsoid(1, 0.2, 0.2, 0.02, std(C.glowSoft, { transparent: true, opacity: 0.35 }), 0, 0.24, 0.5), "nx-gem-glow"));
  const antenna = group("nx-antenna", 0.093, 0.497, 0);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.13, 10), M.blueDeep);
  stem.position.y = 0.065;
  antenna.add(stem);
  antenna.add(named(ellipsoid(0.055, 1, 1, 1, M.glow, 0, 0.16, 0), "nx-antenna-tip"));
  head.add(antenna);
  head.add(buildEyes());
  head.add(buildMouth());
  const blush = group("nx-blush");
  for (const sx of [-1, 1]) {
    const b = ellipsoid(1, 0.07, 0.04, 0.01, M.blush, sx * 0.33, -0.17, 0.5);
    b.rotation.y = sx * 0.5;
    blush.add(b);
  }
  head.add(blush);
  neck.add(head);
  return neck;
}

/** The contract's graph, in proxy geometry. */
export function buildNultron() {
  const d = PROXY_DIMS;
  const root = group("nx-root");
  const body = group("nx-body", 0, d.bodyY, 0);
  body.add(named(ellipsoid(1, 0.33, 0.27, 0.26, M.white, 0, 0.12, 0.02), "nx-torso"));
  body.add(ellipsoid(1, 0.37, 0.21, 0.27, M.blue, 0, 0.34, 0));
  const badgeTex = badgeTexture();
  const badge = new THREE.Mesh(
    new THREE.CircleGeometry(0.11, 32),
    new THREE.MeshStandardMaterial({ color: badgeTex ? 0xffffff : 0xf8f2e8, map: badgeTex, roughness: 0.6 }),
  );
  badge.name = "nx-badge";
  badge.position.set(0, 0.3, 0.272);
  body.add(badge);
  body.add(buildHead());
  body.add(buildArm("l"));
  body.add(buildArm("r"));
  body.add(buildLeg("l"));
  body.add(buildLeg("r"));
  root.add(body);
  root.add(group("nx-fx"));
  return root;
}
