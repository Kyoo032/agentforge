// Nultron hands (owner: modeller): five rounded-mitt variants per hand, built in the hand-local frame.
// Frame (same axes as the world at rest, NOT mirrored): origin = wrist, the arm points down the -Y axis, +Z = front of
// the character, the palm faces the body (-X for the -r hand, +X for the -l hand). Left hands are mirrored copies.
import * as THREE from "three";
import { L } from "./layout.js";
import { MAT } from "./materials.js";

const capsule = (r, len, seg = 20) => new THREE.CapsuleGeometry(r, len, 8, seg);
const ell = (rx, ry, rz, seg = 40) => {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
  g.scale(rx, ry, rz);
  return g;
};
const K = L.mitt / 0.092; // the hand shapes below were drawn for a 0.092 mitt

/** Grip point per variant in the RIGHT-hand frame (x is negated for the left hand). */
const BASE_GRIPS = {
  fist: [-0.03, -0.085, 0],
  open: [-0.03, -0.09, 0],
  point: [-0.03, -0.09, 0],
  thumb: [-0.03, -0.09, 0],
  hold: [-0.045, -0.092, 0],
};
export const GRIPS_R = Object.fromEntries(Object.entries(BASE_GRIPS).map(([k, v]) => [k, v.map((c) => +(c * K).toFixed(4))]));
export const GRIP_AXIS = [0, 0, 1]; // the held object runs front to back through the fist ("hold")
export const HAND_VARIANTS = ["open", "point", "thumb", "hold", "fist"];

export function buildHand(hand, sideId) {
  const sx = sideId === "l" ? -1 : 1;
  const flip = sx < 0;
  const add = (grp, geo, pos, rot = [0, 0, 0]) => {
    const m = new THREE.Mesh(geo, MAT.blue);
    m.castShadow = true;
    m.receiveShadow = true;
    m.position.set(flip ? -pos[0] : pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], flip ? -rot[1] : rot[1], flip ? -rot[2] : rot[2]);
    grp.add(m);
    return m;
  };
  const variant = (name) => {
    const g = new THREE.Group();
    g.name = `nx-hand-${sideId}-${name}`;
    g.visible = name === "fist";
    g.scale.setScalar(K);
    hand.add(g);
    return g;
  };
  const palmBall = (g) => add(g, ell(0.086, 0.096, 0.09), [0.004, -0.084, 0]);
  // stacked curled fingers on the front-inward face of the fist
  const curled = (g, from = 0) => {
    for (let i = from; i < 3; i++) add(g, capsule(0.03, 0.055), [-0.03, -0.055 - 0.04 * i, 0.064], [0, 0, Math.PI / 2]);
  };

  // fist (default, rest)
  const fist = variant("fist");
  palmBall(fist);
  curled(fist);

  // open hand (wave / palm out)
  const open = variant("open");
  add(open, ell(0.05, 0.078, 0.086), [-0.004, -0.085, 0]);
  const lens = [0.06, 0.074, 0.068, 0.054];
  const zs = [0.056, 0.019, -0.019, -0.056];
  for (let i = 0; i < 4; i++) {
    const a = (i - 1.5) * -0.13; // fan the fingers a little
    const base = [-0.004, -0.135, zs[i]];
    const cy = base[1] - Math.cos(a) * (lens[i] / 2 + 0.006);
    const cz = base[2] + Math.sin(a) * (lens[i] / 2 + 0.006);
    add(open, capsule(0.0245, lens[i]), [base[0], cy, cz], [Math.PI - a, 0, 0]);
  }
  add(open, capsule(0.029, 0.056), [0.024, -0.08, 0.082], [Math.PI / 2 + 0.4, 0, -0.75]); // thumb, splayed forward-out

  // point: index finger extended along the arm
  const point = variant("point");
  palmBall(point);
  curled(point, 1);
  add(point, capsule(0.026, 0.085), [-0.026, -0.155, 0.056], [0, 0, 0]);
  add(point, ell(0.026, 0.024, 0.026, 20), [-0.026, -0.05, 0.06]);

  // thumbs-up: thumb out to the front (the poser turns the forearm so +Z points up)
  const thumb = variant("thumb");
  palmBall(thumb);
  curled(thumb);
  add(thumb, capsule(0.03, 0.058), [-0.004, -0.028, 0.12], [Math.PI / 2 + 0.28, 0, 0]);

  // hold: a fat curl of fingers round a grip axis running along Z, with the thumb over the top
  const hold = variant("hold");
  add(hold, ell(0.07, 0.085, 0.078), [0.03, -0.08, 0]);
  const curl = new THREE.TorusGeometry(0.05, 0.033, 24, 56);
  curl.scale(1, 1, 1.75);
  add(hold, curl, [BASE_GRIPS.hold[0], BASE_GRIPS.hold[1], 0]);
  add(hold, ell(0.03, 0.028, 0.03, 20), [-0.05, -0.038, 0.072]);

  const grip = new THREE.Object3D();
  grip.name = `nx-grip-${sideId}`;
  const g0 = GRIPS_R.fist;
  grip.position.set(flip ? -g0[0] : g0[0], g0[1], g0[2]);
  hand.add(grip);
  hand.userData.grips = Object.fromEntries(
    Object.entries(GRIPS_R).map(([k, v]) => [k, [flip ? -v[0] : v[0], v[1], v[2]]]),
  );
  hand.userData.gripAxis = GRIP_AXIS;
}
