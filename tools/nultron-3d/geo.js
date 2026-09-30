// Geometry helpers for the Nultron model (owner: modeller). Pure three.js, no DOM, so it also runs under node.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sgnpow = (v, p) => Math.sign(v) * Math.abs(v) ** p;
export const lerp = (a, b, t) => a + (b - a) * t;

/** Weld coincident vertices (seams, poles) and recompute smooth normals. Keeps only position + index. */
export function weldSmooth(geo, angleScale = null) {
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  const merged = mergeVertices(geo, 1e-5);
  if (angleScale) merged.scale(angleScale[0], angleScale[1], angleScale[2]);
  merged.computeVertexNormals();
  return merged;
}

// ---------------------------------------------------------------------------------------------------------------------
// Superquadric "egg" used for the helmet (and boots, and the icon tile).  alpha runs round the Y axis from the front (+Z),
// beta from the bottom pole to the top pole. e1 shapes the vertical profile (front silhouette), e2 the plan section.
//   P = { rx, ry, rz, e1, e2, egg, botFlat }
// ---------------------------------------------------------------------------------------------------------------------
const C = (t, e) => Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** e;
const S = (t, e) => Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** e;

export function superPoint(alpha, beta, P, out = new THREE.Vector3()) {
  const { rx, ry, rz, e1 = 1, e2 = 1, egg = 0, botFlat = 1 } = P;
  const sv = S(beta, e1);
  const f = 1 - egg * sv;
  const ryEff = sv < 0 ? ry * botFlat : ry;
  return out.set(rx * f * C(beta, e1) * S(alpha, e2), ryEff * sv, rz * f * C(beta, e1) * C(alpha, e2));
}

export function superGeometry(P, wSeg = 192, hSeg = 144) {
  const pos = [];
  const idx = [];
  const v = new THREE.Vector3();
  const e1 = P.e1 ?? 1;
  for (let i = 0; i <= hSeg; i++) {
    // e1 < 1 squares the silhouette and starves the equator of vertices when beta is uniform, so sample y uniformly there
    const beta =
      e1 < 0.95
        ? Math.asin(Math.sign(i / hSeg - 0.5) * Math.abs(2 * (i / hSeg) - 1) ** (1 / e1))
        : -Math.PI / 2 + (Math.PI * i) / hSeg;
    for (let j = 0; j <= wSeg; j++) {
      const alpha = -Math.PI + (2 * Math.PI * j) / wSeg;
      superPoint(alpha, beta, P, v);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < hSeg; i++) {
    for (let j = 0; j < wSeg; j++) {
      const a = i * (wSeg + 1) + j;
      const b = a + wSeg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // winding: outward normals for this parametrisation
  const w = weldSmooth(g);
  ensureOutward(w);
  return w;
}

/** Flip the triangle winding if the mesh normals point inward (test against the bbox centre). */
export function ensureOutward(g) {
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const p = g.attributes.position;
  const n = g.attributes.normal;
  let dot = 0;
  for (let i = 0; i < p.count; i++) {
    dot += (p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i);
  }
  if (dot < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

/** Front (z >= 0) surface height of the superquadric above (x, y). Inverse of superPoint for the front half. */
export function superFrontZ(x, y, P) {
  const { rx, ry, rz, e1 = 1, e2 = 1, egg = 0, botFlat = 1 } = P;
  const ryEff = y < 0 ? ry * botFlat : ry;
  const s = clamp(y / ryEff, -1, 1);
  const f = 1 - egg * s;
  const sinAbs = Math.abs(s) ** (1 / e1);
  const cosB = Math.sqrt(Math.max(0, 1 - sinAbs * sinAbs));
  const cBe = cosB ** e1;
  if (cBe < 1e-6) return 0;
  const cx = Math.abs(x) / (rx * f * cBe);
  if (cx >= 1) return 0;
  const c = (1 - cx ** (2 / e2)) ** (e2 / 2);
  return rz * f * cBe * c;
}

/** Position, unit normal and a quaternion turning +Z onto the normal, for a point on a height-field surface. */
export function surfaceFrame(zFn, x, y, lift = 0) {
  const e = 1e-3;
  const z = zFn(x, y);
  const dzdx = (zFn(x + e, y) - zFn(x - e, y)) / (2 * e);
  const dzdy = (zFn(x, y + e) - zFn(x, y - e)) / (2 * e);
  const n = new THREE.Vector3(-dzdx, -dzdy, 1).normalize();
  const p = new THREE.Vector3(x, y, z).addScaledVector(n, lift);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return { p, n, q };
}

// ---------------------------------------------------------------------------------------------------------------------
// Superellipse outline helpers (the face-plate window, the badge ring)
// ---------------------------------------------------------------------------------------------------------------------
export function superellipsePoint(t, cx, cy, a, b, n) {
  return [cx + a * sgnpow(Math.cos(t), 2 / n), cy + b * sgnpow(Math.sin(t), 2 / n)];
}

/** g < 0 inside the window, 0 on the outline, > 0 outside (matches the GLSL used to cut the helmet). */
export function superellipseG(x, y, cx, cy, a, b, n) {
  const qx = Math.abs((x - cx) / a);
  const qy = Math.abs((y - cy) / b);
  return (qx ** n + qy ** n) ** (1 / n) - 1;
}

/**
 * A polar-grid patch over a height field, bounded by a closed outline: rings k/rings of the outline, `around` steps.
 * outlineFn(t) -> [x, y]; centre -> [cx, cy]; zFn(x, y, s) -> z (s = ring fraction 0..1); colorFn(x, y, s, t) -> [r,g,b].
 */
export function polarPatch({ outlineFn, centre, zFn, rings = 64, around = 192, colorFn = null, uv = false }) {
  const pos = [];
  const uvs = [];
  const col = [];
  const idx = [];
  for (let k = 0; k <= rings; k++) {
    const s = k / rings;
    for (let j = 0; j <= around; j++) {
      const t = (2 * Math.PI * j) / around;
      const [bx, by] = outlineFn(t);
      const x = centre[0] + s * (bx - centre[0]);
      const y = centre[1] + s * (by - centre[1]);
      pos.push(x, y, zFn(x, y, s));
      if (colorFn) col.push(...colorFn(x, y, s, t));
      if (uv) uvs.push(0.5 + 0.5 * s * Math.cos(t), 0.5 + 0.5 * s * Math.sin(t));
    }
  }
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < around; j++) {
      const a = k * (around + 1) + j;
      const b = a + around + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (colorFn) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  if (uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // patches are built facing +Z; make sure normals face +Z
  const n = g.attributes.normal;
  let nz = 0;
  for (let i = 0; i < n.count; i++) nz += n.getZ(i);
  if (nz < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}

/** Smooth closed or open tube along points (used for bezels, ring outlines, mouth curves, antenna stem). */
export function tubeAlong(points, radius, { closed = false, tubular = 128, radial = 16, tension = "centripetal" } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, tension);
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lathe helpers
// ---------------------------------------------------------------------------------------------------------------------
/** Sample a smooth (r, y) profile through control points with a centripetal spline. */
export function splineProfile(ctrl, samples = 120) {
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map(([r, y]) => new THREE.Vector3(r, y, 0)),
    false,
    "centripetal",
  );
  return curve.getPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}

/** Lathe of a profile (Vector2 r,y), welded, optionally squashed in z, with smooth normals. */
export function latheSmooth(profile, { segs = 128, zScale = 1 } = {}) {
  const g = new THREE.LatheGeometry(profile, segs);
  const w = weldSmooth(g, [1, 1, zScale]);
  ensureOutward(w);
  return w;
}

/**
 * A tapered capsule hanging along -Y from y = 0 (the joint) to y = -len. radii = [[t, r], ...] with t in 0..1 along the
 * length. Both ends are round caps of the end radii; pass capTop=false for a flat (open) top hidden inside a joint.
 */
export function sleeve(len, radii, { segs = 64, capSteps = 14, samples = 60 } = {}) {
  const r0 = radii[0][1];
  const r1 = radii[radii.length - 1][1];
  const pts = [];
  for (let k = 0; k <= capSteps; k++) {
    const phi = (Math.PI / 2) * (k / capSteps);
    pts.push(new THREE.Vector2(r0 * Math.sin(phi), r0 * Math.cos(phi)));
  }
  const body = splineProfile(
    radii.map(([t, r]) => [r, -t * len]),
    samples,
  );
  for (let i = 1; i < body.length; i++) pts.push(body[i]);
  for (let k = 1; k <= capSteps; k++) {
    const phi = (Math.PI / 2) * (k / capSteps);
    pts.push(new THREE.Vector2(r1 * Math.cos(phi), -len - r1 * Math.sin(phi)));
  }
  return latheSmooth(pts, { segs });
}

/** Round a closed polygon's corners with quadratic curves and return a THREE.Shape. */
export function roundedPolygonShape(pts, radius) {
  const shape = new THREE.Shape();
  const n = pts.length;
  const at = (i) => pts[(i + n) % n];
  const towards = (a, b, d) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const k = Math.min(d, len / 2) / len;
    return [a[0] + dx * k, a[1] + dy * k];
  };
  const start = towards(at(0), at(1), radius);
  shape.moveTo(start[0], start[1]);
  for (let i = 1; i <= n; i++) {
    const p = at(i);
    const before = towards(p, at(i - 1), radius);
    const after = towards(p, at(i + 1), radius);
    shape.lineTo(before[0], before[1]);
    shape.quadraticCurveTo(p[0], p[1], after[0], after[1]);
  }
  return shape;
}
