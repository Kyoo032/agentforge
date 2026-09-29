// Floating marks: "?", burst lines, sparks, sparkles, swoosh, wave arcs and Z marks. All are real extrusions from Shapes
// (no fonts) in the same glossy vinyl as the character, so they light and reflect like the rest of the scene.
import { THREE, deg, discShape, extrude, mesh, node, put, ribbonShape, rrShape, roundPoly, sphere } from "./kit.js";
import { heartGeometry } from "./floating.js";
import { glowPlane, makeProp, sparkleShape } from "./parts.js";
import { MAT, PALETTE, glowMat, paint } from "./mats.js";

const V2 = (x, y) => new THREE.Vector2(x, y);

// ---------------------------------------------------------------------------------------------------------------------
// thinking: "?"
// ---------------------------------------------------------------------------------------------------------------------

export function thinking() {
  const slate = paint("#43598a", { roughness: 0.32, clearcoat: 0.85, clearcoatRoughness: 0.12 });
  const spine = new THREE.SplineCurve(
    [
      [-0.125, 0.285],
      [-0.1, 0.36],
      [-0.03, 0.415],
      [0.05, 0.41],
      [0.12, 0.35],
      [0.125, 0.275],
      [0.085, 0.205],
      [0.02, 0.15],
      [0.0, 0.085],
    ].map(([x, y]) => V2(x, y)),
  );
  const g = node("question");
  const stroke = mesh(
    extrude(ribbonShape(spine, () => 0.036, { samples: 90 }), { depth: 0.06, bevel: 0.014, seg: 5 }),
    slate,
    "hook",
  );
  g.add(stroke);
  const dot = mesh(extrude(discShape(0.04), { depth: 0.06, bevel: 0.014, seg: 5 }), slate, "dot");
  dot.position.set(0, -0.012, 0);
  g.add(dot);
  return makeProp("thinking", "float", g, { center: true, meta: { size: [0.34, 0.5, 0.09] } });
}

// ---------------------------------------------------------------------------------------------------------------------
// surprised / sparks: fans of short rounded dashes
// ---------------------------------------------------------------------------------------------------------------------

function dashFan({ angles, inner, len, w, depth = 0.045, mat = MAT.blue, lens = null }) {
  const g = node("dashes");
  angles.forEach((a, i) => {
    const l = lens ? lens[i] : len;
    const geo = extrude(rrShape(l, w, w / 2), { depth, bevel: 0.012, seg: 4 });
    const m = mesh(geo, mat, `dash-${i}`);
    const rad = deg(a);
    const c = inner + l / 2;
    put(m, Math.cos(rad) * c, Math.sin(rad) * c, 0, 0, 0, rad);
    g.add(m);
  });
  return g;
}

export function surprised() {
  const g = dashFan({ angles: [28, 58, 88], inner: 0.13, len: 0.2, w: 0.052, lens: [0.18, 0.22, 0.17] });
  return makeProp("surprised", "float", g, { center: true, meta: { size: [0.4, 0.4, 0.06], note: "fan centre is the anchor" } });
}

export function sparks() {
  const g = dashFan({ angles: [24, 66, 108], inner: 0.11, len: 0.13, w: 0.036, depth: 0.035, lens: [0.16, 0.19, 0.13] });
  return makeProp("sparks", "float", g, { center: true, meta: { size: [0.34, 0.34, 0.05] } });
}

// ---------------------------------------------------------------------------------------------------------------------
// celebrating: sparkles
// ---------------------------------------------------------------------------------------------------------------------

function sparkleMark(R, name) {
  const g = node(name);
  const outer = mesh(extrude(sparkleShape(R, 0.16), { depth: 0.02, bevel: 0.007, seg: 3 }), paint(PALETTE.glow, { emissive: PALETTE.glow, emissiveIntensity: 0.55, roughness: 0.3 }), "star-outer");
  const inner = mesh(extrude(sparkleShape(R * 0.66, 0.16), { depth: 0.02, bevel: 0.005, seg: 3 }), glowMat("#e9ffff"), "star-inner");
  inner.position.z = 0.012;
  const halo = glowPlane(R * 3.4, PALETTE.glowSoft, 0.55);
  halo.position.z = -0.03;
  g.add(outer, inner, halo);
  return g;
}

export function celebrating() {
  const g = node("sparkles");
  const spec = [
    [-0.36, 0.34, 0.15],
    [0.1, 0.62, 0.11],
    [0.44, 0.24, 0.09],
    [-0.08, 0.06, 0.07],
    [0.34, 0.74, 0.06],
    [-0.5, 0.7, 0.06],
  ];
  for (const [i, [x, y, r]] of spec.entries()) g.add(put(sparkleMark(r, `sparkle-${i}`), x, y, 0, 0, 0, deg(i * 12 - 10)));
  const dotMats = [MAT.blue, paint(PALETTE.glow), MAT.blush, paint(PALETTE.glowSoft)];
  [
    [-0.16, 0.5, 0.017],
    [0.26, 0.42, 0.014],
    [-0.42, 0.52, 0.012],
    [0.05, 0.3, 0.012],
    [0.5, 0.56, 0.015],
    [-0.28, 0.16, 0.013],
  ].forEach(([x, y, r], i) => {
    const d = mesh(sphere(r, 16), dotMats[i % dotMats.length], `dot-${i}`);
    d.position.set(x, y, 0.01);
    g.add(d);
  });
  return makeProp("celebrating", "float", g, { center: true, meta: { size: [1.2, 0.95, 0.06] } });
}

// ---------------------------------------------------------------------------------------------------------------------
// lets-go: motion swoosh trailing to -X; wave: nested arcs
// ---------------------------------------------------------------------------------------------------------------------

function streak(points, maxHalf, { mat = MAT.blue, depth = 0.03, taper = 1 } = {}) {
  const curve = new THREE.SplineCurve(points.map(([x, y]) => V2(x, y)));
  const half = (t) => maxHalf * Math.sin(Math.PI * (0.18 + 0.82 * t) * 0.5) ** 1.4 * (1 - taper * 0.0) * (0.25 + 0.75 * t);
  return mesh(extrude(ribbonShape(curve, half, { samples: 72 }), { depth, bevel: 0.009, seg: 3 }), mat, "streak");
}

export function letsGo() {
  const g = node("swoosh");
  const lines = [
    { pts: [[-0.5, 0.02], [-0.32, 0.055], [-0.14, 0.05], [0.02, 0.0]], half: 0.046, y: 0.15, x: 0 },
    { pts: [[-0.42, -0.02], [-0.27, 0.01], [-0.11, 0.0], [0.0, -0.03]], half: 0.037, y: -0.03, x: 0.02 },
    { pts: [[-0.3, 0.0], [-0.2, 0.03], [-0.08, 0.02], [0.0, -0.01]], half: 0.03, y: -0.19, x: 0.05, glow: true },
  ];
  for (const { pts, half, y, x, glow } of lines) {
    const opts = glow ? { mat: paint(PALETTE.glowSoft, { emissive: PALETTE.glow, emissiveIntensity: 0.3 }) } : {};
    g.add(put(streak(pts, half, opts), x, y, 0));
  }
  return makeProp("lets-go", "float", g, { center: true, meta: { size: [0.55, 0.42, 0.05], note: "trails toward -X; mirror scale.x for the other direction" } });
}

export function wave() {
  const g = node("arcs");
  [
    [0.17, 0.028, 40, 122],
    [0.27, 0.032, 44, 118],
    [0.37, 0.036, 48, 114],
  ].forEach(([R, half, a0, a1], i) => {
    const arc = new THREE.EllipseCurve(0, 0, R, R, deg(a0), deg(a1), false, 0);
    const m = mesh(extrude(ribbonShape(arc, (t) => half * (0.55 + 0.45 * Math.sin(Math.PI * t)), { samples: 48 }), { depth: 0.035, bevel: 0.01, seg: 3 }), i === 1 ? MAT.blue : MAT.blueGloss, `arc-${i}`);
    g.add(m);
  });
  return makeProp("wave", "float", g, { anchor: [0, 0, 0], meta: { size: [0.75, 0.75, 0.05], note: "arcs open upward around the anchor (the hand); mirror scale.x for the other hand" } });
}

// ---------------------------------------------------------------------------------------------------------------------
// sleep: Z marks
// ---------------------------------------------------------------------------------------------------------------------

function zShape(w, h, t) {
  const hw = w / 2;
  const hh = h / 2;
  const d = t * 1.05;
  return roundPoly(
    [
      [-hw, hh],
      [hw, hh],
      [hw, hh - t],
      [-hw + d, -hh + t],
      [hw, -hh + t],
      [hw, -hh],
      [-hw, -hh],
      [-hw, -hh + t],
      [hw - d, hh - t],
      [-hw, hh - t],
    ],
    t * 0.32,
  );
}

export function sleep() {
  const g = node("zzz");
  [
    [0.0, 0.0, 0.2, "#2688C8", 6],
    [0.2, 0.26, 0.15, "#4d9fd8", 0],
    [0.36, 0.5, 0.11, "#86c0e8", -6],
  ].forEach(([x, y, s, hex, rot], i) => {
    const m = mesh(
      extrude(zShape(s, s * 1.1, s * 0.27), { depth: s * 0.28, bevel: s * 0.06, seg: 4 }),
      paint(hex, { roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.14 }),
      `z-${i}`,
    );
    put(m, x, y, 0, 0, 0, deg(rot));
    g.add(m);
  });
  return makeProp("sleep", "float", g, { center: true, meta: { size: [0.5, 0.65, 0.06] } });
}

// ---------------------------------------------------------------------------------------------------------------------
// single-piece marks the poser places by name (fx-spark, fx-heart, fx-tear)
// ---------------------------------------------------------------------------------------------------------------------

/** One sparkle, centred, about 0.3 across. */
export function sparkOne() {
  return makeProp("spark", "float", sparkleMark(0.14, "sparkle"), { center: true, meta: { size: [0.28, 0.28, 0.05] } });
}

/** A pale-blue speech bubble with a small blue heart on it. */
export function heartBubble() {
  const g = node("heart-bubble");
  const bubbleMat = paint("#cfe6f7", { roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.1 });
  const W = 0.34;
  const H = 0.25;
  g.add(mesh(extrude(rrShape(W - 0.03, H - 0.03, 0.09), { depth: 0.03, bevel: 0.014, seg: 4 }), bubbleMat, "bubble"));
  const tail = roundPoly(
    [
      [-0.07, -0.1],
      [0.03, -0.1],
      [-0.09, -0.2],
    ],
    0.02,
  );
  g.add(mesh(extrude(tail, { depth: 0.03, bevel: 0.01, seg: 3 }), bubbleMat, "tail"));
  const { geo } = heartGeometry(0.13, 0.035, { around: 96, across: 24 });
  const heart = mesh(geo, MAT.blueGloss, "heart");
  heart.position.set(0, 0.0, 0.03);
  g.add(heart);
  return makeProp("heart-mini", "float", g, { center: true, meta: { size: [0.34, 0.36, 0.06] } });
}

/** A glossy cyan teardrop for the error state. */
export function tear() {
  const s = new THREE.Shape();
  s.moveTo(0.007, 0.082);
  s.bezierCurveTo(0.024, 0.05, 0.055, 0.0, 0.055, -0.03);
  s.bezierCurveTo(0.055, -0.065, 0.03, -0.085, 0, -0.085);
  s.bezierCurveTo(-0.03, -0.085, -0.055, -0.065, -0.055, -0.03);
  s.bezierCurveTo(-0.055, 0.0, -0.024, 0.05, -0.007, 0.082);
  s.quadraticCurveTo(0, 0.092, 0.007, 0.082);
  const g = mesh(
    extrude(s, { depth: 0.03, bevel: 0.016, seg: 5 }),
    paint("#6ccbf0", { roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
    "drop",
  );
  return makeProp("tear", "float", g, { center: true, meta: { size: [0.14, 0.2, 0.06] } });
}
