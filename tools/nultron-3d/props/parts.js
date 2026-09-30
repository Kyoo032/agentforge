// Reusable prop parts: glow planes, holo panels, holo bands, and the wrapper every prop goes through.
import {
  THREE,
  TAU,
  empty,
  extrude,
  frameShape,
  mesh,
  node,
  put,
  rrShape,
} from "./kit.js";
import { DIMS } from "./dims.js";
import { MAT, PALETTE, glassMat, glowMat } from "./mats.js";
import { glowTex, ringBandTex } from "./tex.js";

/** Soft cyan glow on a plane facing +Z (normal alpha blending, so it reads on light and dark backgrounds alike). */
export function glowPlane(size, hex = PALETTE.glow, opacity = 0.5, aspect = 1) {
  const m = new THREE.MeshBasicMaterial({
    map: glowTex(),
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const g = mesh(new THREE.PlaneGeometry(size * aspect, size), m, "glow");
  g.renderOrder = -1;
  return g;
}

/**
 * A translucent holo window: glass slab, glowing rounded frame, optional content texture on the front and a soft glow
 * behind. Faces +Z, centred on the origin.
 */
export function holoPanel({
  w,
  h,
  r = 0.05,
  tex = null,
  name = "holo-panel",
  edge = 0.012,
  tint = "#8fe3ee",
  opacity = 0.2,
  glow = 0.32,
  inset = 0.9,
}) {
  const g = node(name);
  const glass = mesh(extrude(rrShape(w, h, r), { depth: 0.006, bevel: 0.004, seg: 2 }), glassMat({ color: tint, opacity }), "glass");
  glass.renderOrder = 1;
  g.add(glass);
  if (tex) {
    const plane = mesh(
      new THREE.PlaneGeometry(w * inset, h * inset),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide }),
      "content",
    );
    plane.position.z = 0.0065;
    plane.renderOrder = 2;
    g.add(plane);
  }
  const rim = mesh(
    extrude(frameShape(w + 0.006, h + 0.006, r + 0.003, edge), { depth: 0.008, bevel: 0.0025, seg: 2 }),
    glowMat(PALETTE.glow, 0.95),
    "edge",
  );
  rim.renderOrder = 3;
  g.add(rim);
  if (glow > 0) {
    const gl = glowPlane(Math.max(w, h) * 1.5, PALETTE.glow, glow, w / h);
    gl.position.z = -0.03;
    g.add(gl);
  }
  return g;
}

/**
 * A holo band around the Y axis: an open translucent cylinder wearing the segment texture, glowing top and bottom
 * edges. Because it is real 3D the far side sits behind whatever stands inside it and the near side in front.
 */
export function holoBand({ R = 0.5, h = 0.08, tube = 0.009, opacity = 0.62, segs = 112, name = "holo-band", edges = true }) {
  const g = node(name);
  const tex = ringBandTex()?.clone() ?? null;
  if (tex) {
    tex.repeat.set(Math.max(2, Math.round((TAU * R) / (h * 8))), 1);
    tex.needsUpdate = true;
  }
  const wall = mesh(
    new THREE.CylinderGeometry(R, R, h, segs, 1, true),
    new THREE.MeshBasicMaterial({
      map: tex,
      color: tex ? 0xffffff : PALETTE.glowSoft,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
    "wall",
  );
  wall.renderOrder = 1;
  g.add(wall);
  if (edges) {
    for (const s of [-1, 1]) {
      const t = mesh(new THREE.TorusGeometry(R, tube, 10, segs), glowMat(PALETTE.glow, 0.95), "edge");
      t.rotation.x = Math.PI / 2;
      t.position.y = (s * h) / 2;
      t.renderOrder = 3;
      g.add(t);
    }
  }
  return g;
}

/** Four-point sparkle Shape with concave sides; `pinch` is how far the waist is pulled in (0..1). */
export function sparkleShape(R, pinch = 0.18) {
  const s = new THREE.Shape();
  const k = R * pinch;
  s.moveTo(0, R);
  s.quadraticCurveTo(k, k, R, 0);
  s.quadraticCurveTo(k, -k, 0, -R);
  s.quadraticCurveTo(-k, -k, -R, 0);
  s.quadraticCurveTo(-k, k, 0, R);
  return s;
}

/** Bounds centre of every non-glow mesh under `obj`, in `obj`'s own space (glow planes would skew it). */
function artCentre(obj) {
  const box = new THREE.Box3();
  obj.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((o) => {
    if (!o.isMesh || o.name === "glow" || o.name === "beam") return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv));
  });
  return box.getCenter(new THREE.Vector3());
}

/**
 * Wraps a prop: names the group `nx-prop-<name>`, scales the artwork (`body`) by the mitt size when it is hand-held, and
 * adds the marker empties the rig looks for.
 *
 *   kind "held": a `grip` empty at the point the mitt closes (plus `grip-l` / `grip-r` for two-handed props). The prop
 *                 is drawn with its handle along +Y (working end toward +Y) and its face toward +Z; the poser's
 *                 HELD_ROT [90, 0, 0] turns that into the hand's hold axis (+Z) and face (-Y). Two-handed props
 *                 (calculating, filming, heart) are centred on the group origin, which is also their `grip` (the midpoint
 *                 between the two mitts).
 *   kind "worn" / "float": an `anchor` empty. `center: true` moves the artwork so its bounds centre sits on the origin.
 */
export function makeProp(
  name,
  kind,
  art,
  { grip = [0, 0, 0], gripL = null, gripR = null, anchor = [0, 0, 0], hands = "", center = false, meta = {} } = {},
) {
  const root = node(`nx-prop-${name}`);
  const body = node("body", ...(Array.isArray(art) ? art : [art]));
  const k = kind === "held" ? DIMS.mittRadius / 0.09 : 1;
  body.scale.setScalar(k);
  if (center) {
    const c = artCentre(body);
    body.position.set(-c.x * k, -c.y * k, -c.z * k);
  }
  root.add(body);
  if (kind === "held") {
    root.add(empty("grip", ...grip.map((v) => v * k)));
    if (gripL) root.add(empty("grip-l", ...gripL.map((v) => v * k)));
    if (gripR) root.add(empty("grip-r", ...gripR.map((v) => v * k)));
  } else {
    root.add(empty("anchor", ...anchor));
  }
  root.userData = { name, kind, hands, mittScale: k, ...meta };
  return root;
}

export { MAT, PALETTE, put, glowMat, glassMat };
