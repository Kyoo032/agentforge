// Nultron 3D character (owner: modeller). buildNultron() returns the `nx-root` group described in CONTRACT.md.
// Rest pose: every pivot rotation is zero (arms hang straight down, legs straight, head level, eyes open, idle mouth,
// fist hands). Left/right are screen-relative: `-l` sits at x < 0.
import * as THREE from "three";
import { L } from "./layout.js";
import { MAT } from "./materials.js";
import { buildHead } from "./head.js";
import { buildBody, buildNeck } from "./body.js";

export { MAT, L };
export const EYES = ["open", "blink", "happy", "surprised", "closed"];
export const MOUTHS = ["idle", "talk", "smile", "sad", "o", "sleep"];
export const HANDS = ["open", "point", "thumb", "hold", "fist"];

const named = (o, n) => {
  o.name = n;
  return o;
};

/** Show exactly one child of `group` named `${prefix}${name}`; returns false when none matches. */
export function showOnly(group, prefix, name) {
  let hit = false;
  for (const c of group.children) {
    if (!c.name.startsWith(prefix)) continue;
    const on = c.name === prefix + name;
    c.visible = on;
    hit ||= on;
  }
  return hit;
}
export const setEyes = (root, name) => showOnly(root.getObjectByName("nx-eyes"), "nx-eyes-", name);
export const setMouth = (root, name) => showOnly(root.getObjectByName("nx-mouth"), "nx-mouth-", name);
/** side: "l" | "r". Also moves nx-grip-<side> to that variant's grip point. */
export function setHand(root, side, variant) {
  const hand = root.getObjectByName(`nx-hand-${side}`);
  const ok = showOnly(hand, `nx-hand-${side}-`, variant);
  const g = hand.userData.grips[variant];
  if (ok && g) hand.getObjectByName(`nx-grip-${side}`).position.set(g[0], g[1], g[2]);
  return ok;
}

/** opts.tile = true builds the rounded-square helmet used by the app-icon view. */
export function buildNultron(opts = {}) {
  const root = named(new THREE.Group(), "nx-root");
  const body = named(new THREE.Group(), "nx-body");
  body.position.set(0, L.hipY, 0);
  root.add(body);

  buildBody(body);

  const neck = buildNeck();
  neck.position.set(0, L.neckY - L.hipY, 0);
  body.add(neck);

  const head = named(new THREE.Group(), "nx-head");
  head.position.set(0, L.head.center[1] - L.neckY, 0);
  neck.add(head);
  buildHead(head, { tile: !!opts.tile });

  root.add(named(new THREE.Group(), "nx-fx"));

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow ??= true;
      o.receiveShadow ??= true;
    }
  });
  return root;
}
