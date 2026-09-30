// Small geometry kit shared by the prop builders. Every helper returns a NEW object; nothing here mutates its inputs.
// Units follow CONTRACT.md: Y up, +Z faces the camera, 1 unit = half the character's height (body ~2.0 tall).
import * as THREE from "three";

export { THREE };
export const TAU = Math.PI * 2;
export const deg = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------------------------------------------------
// Scene-graph helpers
// ---------------------------------------------------------------------------------------------------------------------

/** A named Group holding `kids` (falsy kids are skipped). */
export function node(name, ...kids) {
  const g = new THREE.Group();
  g.name = name;
  for (const k of kids) if (k) g.add(k);
  return g;
}

/** A named empty (Object3D) at a position: the `grip` / `anchor` markers. */
export function empty(name, x = 0, y = 0, z = 0) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  return o;
}

export function mesh(geo, mat, name = "") {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

/** Sets position (and optional euler rotation in radians) on `obj` and returns it. */
export function put(obj, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  return obj;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2D shapes
// ---------------------------------------------------------------------------------------------------------------------

/** Rounded rectangle centred on the origin. */
export function rrShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.max(0.0005, Math.min(r, w / 2, h / 2));
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - rr);
  s.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x + rr, y + h);
  s.absarc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + rr);
  s.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** A rounded-rectangle frame: outer w x h with a rounded hole `border` in from every edge. */
export function frameShape(w, h, r, border) {
  const s = rrShape(w, h, r);
  s.holes.push(rrShape(w - 2 * border, h - 2 * border, Math.max(0.001, r - border)));
  return s;
}

/** Polygon (array of [x, y]) with every corner rounded by up to `r`. */
export function roundPoly(pts, r) {
  const n = pts.length;
  const P = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  const s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const prev = P[(i + n - 1) % n];
    const cur = P[i];
    const next = P[(i + 1) % n];
    const d1 = prev.clone().sub(cur);
    const d2 = next.clone().sub(cur);
    const rr = Math.min(r, d1.length() / 2, d2.length() / 2);
    const a = cur.clone().add(d1.setLength(rr));
    const b = cur.clone().add(d2.setLength(rr));
    if (i === 0) s.moveTo(a.x, a.y);
    else s.lineTo(a.x, a.y);
    s.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
  }
  s.closePath();
  return s;
}

/** Circle as a Shape. */
export function discShape(r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  s.absarc(cx, cy, r, 0, TAU, false);
  return s;
}

/**
 * A stroke as a closed Shape: the 2D `curve` (anything with getPoints) swept by half-width `half(t)`, t in 0..1.
 * `caps: "round"` closes both ends with a half circle (skipped where the stroke tapers to a point).
 */
export function ribbonShape(curve, half, { caps = "round", samples = 64 } = {}) {
  const pts = curve.getPoints(samples);
  const n = pts.length;
  const left = [];
  const right = [];
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
    dirs.push(t);
    const w = Math.max(0.0004, half(i / (n - 1)));
    left.push(new THREE.Vector2(pts[i].x - t.y * w, pts[i].y + t.x * w));
    right.push(new THREE.Vector2(pts[i].x + t.y * w, pts[i].y - t.x * w));
  }
  const poly = [...left];
  const capArc = (centre, dir, w, from) => {
    const out = [];
    const base = Math.atan2(dir.y, dir.x);
    for (let k = 1; k < 10; k++) {
      const a = base + from * (Math.PI / 2 - (k / 10) * Math.PI);
      out.push(new THREE.Vector2(centre.x + Math.cos(a) * w, centre.y + Math.sin(a) * w));
    }
    return out;
  };
  const wEnd = half(1);
  const wStart = half(0);
  if (caps === "round" && wEnd > 0.004) poly.push(...capArc(pts[n - 1], dirs[n - 1], wEnd, 1));
  poly.push(...[...right].reverse());
  if (caps === "round" && wStart > 0.004) poly.push(...capArc(pts[0], dirs[0].clone().negate(), wStart, 1));
  const s = new THREE.Shape();
  for (const [i, p] of poly.entries()) {
    if (i === 0) s.moveTo(p.x, p.y);
    else s.lineTo(p.x, p.y);
  }
  s.closePath();
  return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Smooths the normals of an ExtrudeGeometry's side + bevel faces (material group 1) by welding vertices by position, and
 * leaves the flat caps (group 0) exactly flat. Without this a beveled slab shades in visible facets.
 */
export function smoothSides(geo) {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const side = geo.groups.find((g) => g.materialIndex === 1);
  if (!side || !nor) return geo;
  const key = (i) =>
    `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
  const acc = new Map();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const end = side.start + side.count;
  for (let i = side.start; i < end; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    for (let k = 0; k < 3; k++) {
      const kk = key(i + k);
      const v = acc.get(kk) ?? new THREE.Vector3();
      v.add(n);
      acc.set(kk, v);
    }
  }
  for (let i = side.start; i < end; i++) {
    const v = acc.get(key(i)).clone().normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  nor.needsUpdate = true;
  return geo;
}

/**
 * Extrudes a Shape and centres it on z = 0. NOTE: the bevel grows the outline by `bevel` on every side and the total
 * thickness is `depth + 2 * bevel`.
 */
export function extrude(shape, { depth = 0.02, bevel = 0.006, seg = 4, curve = 18, smooth = true } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: seg,
    curveSegments: curve,
  });
  g.translate(0, 0, -depth / 2);
  return smooth && bevel > 0 ? smoothSides(g) : g;
}

/** A rounded slab of exactly w x h x d (bevel included), centred on the origin, facing +Z. */
export function slab(w, h, d, { r = 0.04, bevel = 0.012, seg = 5, curve = 18 } = {}) {
  const b = Math.min(bevel, d / 2 - 0.0005);
  return extrude(rrShape(w - 2 * b, h - 2 * b, Math.max(0.001, r - b)), {
    depth: Math.max(0.0005, d - 2 * b),
    bevel: b,
    seg,
    curve,
  });
}

/** A rounded frame slab (window) of exactly w x h x d with a hole `border` wide. */
export function frameSlab(w, h, d, border, { r = 0.05, bevel = 0.008, seg = 4 } = {}) {
  const b = Math.min(bevel, d / 2 - 0.0005);
  const s = rrShape(w - 2 * b, h - 2 * b, Math.max(0.001, r - b));
  s.holes.push(rrShape(w - 2 * border + 2 * b, h - 2 * border + 2 * b, Math.max(0.001, r - border + b)));
  return extrude(s, { depth: Math.max(0.0005, d - 2 * b), bevel: b, seg });
}

/** Smooth surface of revolution around Y through `pts` ([radius, y] pairs), resampled through a spline. */
export function smoothLathe(pts, { samples = 72, seg = 56, closed = false } = {}) {
  const curve = new THREE.SplineCurve(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const line = curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  if (closed) line.push(line[0].clone());
  return new THREE.LatheGeometry(line, seg);
}

/** Lathe through the points exactly (sharp corners stay sharp), rounded where `round` > 0 via two-point bevels. */
export function lathe(pts, seg = 56) {
  return new THREE.LatheGeometry(
    pts.map((p) => new THREE.Vector2(p[0], p[1])),
    seg,
  );
}

/** Capsule along +Y from y0 to y1 (round caps included in the length). */
export function capsuleY(r, y0, y1, radial = 20) {
  const len = Math.max(0, y1 - y0 - 2 * r);
  const g = new THREE.CapsuleGeometry(r, len, 10, radial);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/** Cylinder along Y between y0 and y1 (radius rBottom at y0, rTop at y1). */
export function cylY(rBottom, rTop, y0, y1, radial = 40, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, radial, 1, open);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/** Torus lying in the XY plane (a ring facing +Z). */
export function ringXY(R, tube, radial = 16, tubular = 72) {
  return new THREE.TorusGeometry(R, tube, radial, tubular);
}

/** Tube through 3D points, smooth. */
export function tubeAlong(points, radius, { tubular = 96, radial = 14, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2] ?? 0)),
    closed,
    "catmullrom",
    0.5,
  );
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

export function sphere(r, seg = 32) {
  return new THREE.SphereGeometry(r, seg, Math.round(seg * 0.6));
}

/** Union bounds of every mesh under `obj` (world space, current transforms). */
export function boundsOf(obj) {
  obj.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(obj);
}

/** Cylinder along Y from y0 to y1 with rounded rims (fillet f), radius r. Smooth-shaded. */
export function roundedCylY(r, y0, y1, f = 0.006, seg = 44) {
  const ff = Math.min(f, r * 0.9, (y1 - y0) / 2 - 0.0001);
  const pts = [new THREE.Vector2(0, y0)];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - ff + ff * Math.sin(a), y0 + ff - ff * Math.cos(a)));
  }
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - ff + ff * Math.cos(a), y1 - ff + ff * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(0, y1));
  return new THREE.LatheGeometry(pts, seg);
}
