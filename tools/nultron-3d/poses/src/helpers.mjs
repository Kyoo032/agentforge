// Authoring helpers for states.mjs: side-aware coordinates, hand aims for held props, two-handed prop placement.
import * as THREE from "three";
import { PROPS } from "../../props.js";
import { headQuat, placementMatrix } from "../../rig.js";

/** World point from a side-relative description: x is "outward from the midline" for that side. */
export const S = (side, x, y, z) => [side === "l" ? -x : x, y, z];

/** Aims that hold a prop upright: the handle (hand Z) along `y`, the prop face (hand -Y) along `z`. rot must be [90, 0, 0]. */
export const heldAims = ({ y = [0, 1, 0.12], z = [0, -0.12, 1], wy = 0.6, wz = 0.5 } = {}) => [
  { local: [0, 0, 1], world: y, w: wy, raw: true },
  { local: [0, -1, 0], world: z, w: wz, raw: true },
];

/** Rotation that maps the prop's +Y (handle) onto the hand's +Z (the hold axis) and its face (+Z) onto the hand's -Y. */
export const HELD_ROT = [90, 0, 0];

const BODY_REST = new THREE.Vector3(0, 0.44, 0);
const V = (a) => new THREE.Vector3(...a);

/**
 * Places a two-handed prop on the body and returns its spec plus the world grip points of both hands.
 * `at` is where the prop's own `grip` empty (the midpoint between the hands) goes, in WORLD coordinates.
 */
export function twoHanded(name, { at, rot = [0, 0, 0], body = {}, scale = 1, hide }) {
  const bodyPos = BODY_REST.clone().add(V(body.offset ?? [0, 0, 0]));
  const q = headQuat(body.lean ?? [0, 0, 0]);
  const local = V(at).sub(bodyPos).applyQuaternion(q.clone().invert());
  const spec = { name, attach: "body", pos: local.toArray().map((v) => +v.toFixed(3)), rot, scale, hide };
  const obj = PROPS[name]();
  const M = placementMatrix(obj, spec, true);
  const world = new THREE.Matrix4().compose(bodyPos, q, new THREE.Vector3(1, 1, 1)).multiply(M);
  const grips = {};
  for (const side of ["l", "r"]) {
    const g = obj.getObjectByName(`grip-${side}`);
    grips[side] = g ? g.position.clone().applyMatrix4(world).toArray().map((v) => +v.toFixed(3)) : at;
  }
  return { spec, gripL: grips.l, gripR: grips.r };
}

/**
 * Like heldAims, for a prop whose rot is not exactly HELD_ROT: the prop's +Y (handle) and +Z (face) are turned into the
 * hand frame by `rot` (Euler XYZ degrees, as the rig applies it) and aimed at the world directions y and z.
 */
export function propAims(rot, { y = [0, 1, 0.12], z = [0, -0.12, 1], wy = 0.6, wz = 0.5 } = {}) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rot[0] * Math.PI) / 180, (rot[1] * Math.PI) / 180, (rot[2] * Math.PI) / 180, "XYZ"));
  const inHand = (a) => new THREE.Vector3(...a).applyQuaternion(q).toArray();
  return [
    { local: inHand([0, 1, 0]), world: y, w: wy, raw: true },
    { local: inHand([0, 0, 1]), world: z, w: wz, raw: true },
  ];
}
