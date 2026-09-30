import * as THREE from "three";
import { PROPS } from "../../props.js";
const f = (v) => v.toArray().map((x) => +x.toFixed(3));
for (const [name, make] of Object.entries(PROPS)) {
  const g = make();
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g);
  const marks = {};
  for (const n of ["grip", "grip-l", "grip-r", "anchor"]) {
    const o = g.getObjectByName(n);
    if (o) marks[n] = f(o.position);
  }
  const kids = g.getObjectByName("body")?.children.map((c) => {
    const b = new THREE.Box3().setFromObject(c);
    return `${c.name}[${f(b.min)}..${f(b.max)}]`;
  });
  console.log(name.padEnd(16), "bbox", f(box.min), f(box.max), JSON.stringify(marks), g.userData.hands ?? "", g.userData.tip ? `tip ${g.userData.tip}` : "");
  if (kids && kids.length < 6) console.log("     ", kids.join("  "));
}
