// Dumps the world axes of nx-grip-l / nx-grip-r for each state (node, no DOM).
import * as THREE from "../../node_modules/three/build/three.module.js";
import { buildNultron } from "../../character.js";
import { applyPose } from "../../rig.js";

const states = process.argv.slice(2);
const root = buildNultron();
const f = (v) => `[${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}]`;
for (const s of states) {
  applyPose(root, s);
  root.updateMatrixWorld(true);
  for (const side of ["l", "r"]) {
    const g = root.getObjectByName(`nx-grip-${side}`);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    g.matrixWorld.decompose(p, q, new THREE.Vector3());
    const ax = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(q);
    console.log(`${s} ${side}: pos ${f(p)}  X ${f(ax(1, 0, 0))}  Y ${f(ax(0, 1, 0))}  Z ${f(ax(0, 0, 1))}`);
  }
}
