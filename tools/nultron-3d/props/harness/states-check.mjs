// Applies every state with the real rig + props under node and lists the props / fx each one attached.
import { buildNultron } from "../../character.js";
import { applyPose, STATE_NAMES } from "../../rig.js";
const root = buildNultron();
for (const s of STATE_NAMES) {
  applyPose(root, s);
  const found = [];
  root.traverse((o) => {
    if (o.name.startsWith("nx-prop-") && o.visible) found.push(`${o.name.slice(8)}@${o.parent?.name}`);
  });
  console.log(s.padEnd(12), found.join(", ") || "-");
}
