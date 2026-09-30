// Checks that armFK() (the IK's forward model) equals the real scene graph for random poses, both sides.
import * as THREE from "three";
import { armFor, armFK, loadModel } from "./kin.mjs";
import { flexQuat, headQuat, shoulderQuat } from "../../rig.js";

const root = loadModel();
const rnd = (a, b) => a + Math.random() * (b - a);
let worst = 0;
const arms = { l: armFor(root, "l"), r: armFor(root, "r") };
for (const side of ["l", "r"]) {
  const arm = arms[side];
  for (let i = 0; i < 40; i++) {
    const p = {
      shoulder: [rnd(0, 170), rnd(-90, 150), rnd(-120, 120)],
      elbow: [rnd(0, 140), rnd(-20, 20), rnd(-30, 30)],
      hand: [rnd(-30, 50), rnd(-20, 20), rnd(-60, 60)],
    };
    const lean = [rnd(-10, 10), rnd(-10, 10), rnd(-10, 10)];
    const offset = [rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1)];
    const body = root.getObjectByName("nx-body");
    body.position.set(0, 0.44, 0).add(new THREE.Vector3(...offset));
    body.quaternion.copy(headQuat(lean));
    root.getObjectByName(`nx-shoulder-${side}`).quaternion.copy(shoulderQuat(side, p.shoulder));
    root.getObjectByName(`nx-elbow-${side}`).quaternion.copy(flexQuat(side, p.elbow));
    root.getObjectByName(`nx-hand-${side}`).quaternion.copy(flexQuat(side, p.hand));
    root.updateMatrixWorld(true);
    const variant = ["fist", "hold", "open"][i % 3];
    const g = arm.grips[variant];
    const grip = root.getObjectByName(`nx-grip-${side}`);
    grip.position.copy(g);
    root.updateMatrixWorld(true);
    const real = grip.getWorldPosition(new THREE.Vector3());
    const fk = armFK(arm, side, p, variant, { offset, lean }).G;
    worst = Math.max(worst, real.distanceTo(fk));
  }
}
console.log("worst FK error (units):", worst.toExponential(2));
const l = arms.l;
const r = arms.r;
console.log("arm r: o1", r.o1.toArray(), "o2", r.o2.toArray(), "shoulderRel", r.shoulderRel.toArray(), "fist grip", r.grips.fist.toArray());
console.log("arm l: o1", l.o1.toArray(), "o2", l.o2.toArray(), "shoulderRel", l.shoulderRel.toArray(), "fist grip", l.grips.fist.toArray());
