// Lists a prop's parts in the posed world: node name, world bbox centre and size. Usage: prop-parts.mjs <state> [propName]
import * as THREE from "three";
import { buildNultron } from "../../character.js";
import { applyPose, POSES } from "../../rig.js";
const state = process.argv[2];
const root = buildNultron();
applyPose(root, state);
root.updateMatrixWorld(true);
const f = (v) => v.toArray().map((x) => +x.toFixed(3));
const name = process.argv[3] ?? [].concat(POSES.states[state].prop)[0].name;
const prop = root.getObjectByName(`nx-prop-${name}`);
const tmp = new THREE.Box3();
prop.traverse((o) => {
  if (!o.isMesh) return;
  tmp.setFromObject(o);
  console.log(o.name.padEnd(16), "centre", f(tmp.getCenter(new THREE.Vector3())), "size", f(tmp.getSize(new THREE.Vector3())));
});
