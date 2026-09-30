// Node smoke test: builds the model and checks the contract's node names and parents.
import * as THREE from "three";
import { buildNultron, EYES, MOUTHS, HANDS } from "./character.js";
const t0 = performance.now();
const root = buildNultron();
console.log("built in", Math.round(performance.now() - t0), "ms");
const need = {
  "nx-root": null, "nx-body": "nx-root", "nx-torso": "nx-body", "nx-badge": "nx-body", "nx-neck": "nx-body", "nx-head": "nx-neck",
  "nx-helmet": "nx-head", "nx-faceplate": "nx-head", "nx-ear-l": "nx-head", "nx-ear-r": "nx-head", "nx-gem": "nx-head", "nx-gem-glow": "nx-head",
  "nx-antenna": "nx-head", "nx-antenna-tip": "nx-antenna", "nx-eyes": "nx-head", "nx-mouth": "nx-head", "nx-blush": "nx-head", "nx-fx": "nx-root",
};
for (const s of ["l", "r"]) {
  Object.assign(need, {
    [`nx-shoulder-${s}`]: "nx-body", [`nx-upperarm-${s}`]: `nx-shoulder-${s}`, [`nx-elbow-${s}`]: `nx-upperarm-${s}`,
    [`nx-forearm-${s}`]: `nx-elbow-${s}`, [`nx-hand-${s}`]: `nx-forearm-${s}`, [`nx-grip-${s}`]: `nx-hand-${s}`,
    [`nx-hip-${s}`]: "nx-body", [`nx-leg-${s}`]: `nx-hip-${s}`, [`nx-foot-${s}`]: `nx-leg-${s}`,
  });
  for (const h of HANDS) need[`nx-hand-${s}-${h}`] = `nx-hand-${s}`;
}
for (const e of EYES) need[`nx-eyes-${e}`] = "nx-eyes";
for (const m of MOUTHS) need[`nx-mouth-${m}`] = "nx-mouth";
let bad = 0;
for (const [name, parent] of Object.entries(need)) {
  const o = root.getObjectByName(name);
  if (!o) { console.log("MISSING", name); bad++; continue; }
  if (parent && o.parent?.name !== parent) { console.log("WRONG PARENT", name, "->", o.parent?.name, "want", parent); bad++; }
}
const vis = (g) => g.children.filter((c) => c.visible).map((c) => c.name);
console.log("eyes visible", vis(root.getObjectByName("nx-eyes")), "mouth", vis(root.getObjectByName("nx-mouth")));
console.log("hand-l visible", vis(root.getObjectByName("nx-hand-l")));
const box = new THREE.Box3().setFromObject(root);
console.log("bounds", box.min.toArray().map((v) => +v.toFixed(3)), box.max.toArray().map((v) => +v.toFixed(3)));
let tris = 0;
root.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
console.log("triangles", tris, bad ? `PROBLEMS: ${bad}` : "tree OK");
process.exit(bad ? 1 : 0);
