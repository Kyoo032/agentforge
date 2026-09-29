// Node smoke test: every prop builds, is named nx-prop-<name>, has the marker empties, and stays finite.
import * as THREE from "../../node_modules/three/build/three.module.js";
import { PROPS } from "../../props.js";

const HELD = new Set(["writing", "searching", "calculating", "reviewing", "painting", "filming", "editing", "presenting", "charting-held", "love", "heart"]);
let bad = 0;
for (const [key, make] of Object.entries(PROPS)) {
  const o = make();
  const problems = [];
  const expected = `nx-prop-${key === "heart" ? "love" : key}`;
  if (o.name !== expected) problems.push(`name ${o.name} != ${expected}`);
  const marker = o.userData.kind === "held" ? "grip" : "anchor";
  if (!o.getObjectByName(marker)) problems.push(`no ${marker}`);
  if (o.userData.kind === "held" && HELD.has(key) && ["calculating", "filming", "love", "heart"].includes(key)) {
    if (!o.getObjectByName("grip-l") || !o.getObjectByName("grip-r")) problems.push("two-handed prop lacks grip-l/grip-r");
  }
  let meshes = 0;
  let verts = 0;
  o.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  o.traverse((n) => {
    if (n.isMesh) {
      meshes++;
      verts += n.geometry.attributes.position.count;
      const p = n.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 97) if (!Number.isFinite(p[i])) problems.push(`NaN in ${n.name}`);
      n.geometry.computeBoundingBox();
      if (n.name !== "glow" && n.name !== "beam") box.union(n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld));
    }
  });
  const s = box.getSize(new THREE.Vector3());
  console.log(`${problems.length ? "FAIL" : "ok  "} ${key.padEnd(16)} kind=${String(o.userData.kind).padEnd(5)} meshes=${String(meshes).padStart(3)} verts=${String(verts).padStart(6)} size=${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)} ${problems.join("; ")}`);
  bad += problems.length;
}
console.log(bad ? `${bad} problem(s)` : "all props ok");
process.exit(bad ? 1 : 0);
