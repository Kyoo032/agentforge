// Worn props: headphones that fit over the ear pods. Everything is in nx-head's local frame (origin = helmet centre) and
// comes from dims.json's ear-pod centres and radii and helmet top (see dims.js). Left/right are screen-relative: the `l`
// pod is at x < 0.
import { THREE, mesh, node, put, roundedCylY, tubeAlong } from "./kit.js";
import { DIMS } from "./dims.js";
import { makeProp } from "./parts.js";
import { MAT, PALETTE, glowMat } from "./mats.js";

const CUP_RADIUS = 0.19; // dims.json suggests ~0.17 for a cup on a 0.152 pod; a touch chunkier reads better at 30 px
const BAND_CLEARANCE = 0.075; // band height above the helmet top
const BAND_SQUARE = 2.5; // superellipse exponent of the band (2 = ellipse), so it hugs the round dome
const BAND_SETBACK = 0.11; // how far behind the antenna the band passes over the crown

/** One ear cup, axis along +Y: cushion at y = 0 (against the helmet), outer cap at y = depth. */
function cup(Rc, depth) {
  const g = node("cup");
  const cushion = mesh(new THREE.TorusGeometry(Rc * 0.8, Rc * 0.17, 18, 56), MAT.whiteGloss, "cushion");
  cushion.rotation.x = Math.PI / 2;
  cushion.position.y = Rc * 0.06;
  g.add(cushion);
  g.add(mesh(roundedCylY(Rc, Rc * 0.1, depth, Rc * 0.28), MAT.blue, "shell"));
  g.add(mesh(roundedCylY(Rc * 0.7, depth - 0.005, depth + Rc * 0.12, Rc * 0.12), MAT.blueDeep, "cap"));
  const ring = mesh(new THREE.TorusGeometry(Rc * 0.46, Rc * 0.05, 10, 48), glowMat(PALETTE.glow), "led-ring");
  put(ring, 0, depth + Rc * 0.12, 0, Math.PI / 2, 0, 0);
  g.add(ring);
  return g;
}

export function listening() {
  const { l, r } = DIMS.earPod;
  const g = node("headphones");
  const cy = (l.center[1] + r.center[1]) / 2;
  const cz = (l.center[2] + r.center[2]) / 2;
  const podX = (Math.abs(l.center[0]) + Math.abs(r.center[0])) / 2;
  const podHalf = (l.depth + r.depth) / 4;
  const inner = podX - podHalf - 0.03; // cushion face, just inside the helmet skin
  const outer = podX + podHalf + 0.024; // outer cap clears the pod's outer face
  const depth = outer - inner;

  for (const [pod, sign] of [
    [l, -1],
    [r, 1],
  ]) {
    const holder = node(sign > 0 ? "cup-r" : "cup-l", cup(CUP_RADIUS, depth));
    // the cup's +Y axis points out from the head
    holder.rotation.z = -sign * (Math.PI / 2);
    holder.position.set(sign * inner, pod.center[1], pod.center[2]);
    g.add(holder);
  }

  const rx = podX + depth * 0.1;
  const ry = DIMS.helmet.top - cy + BAND_CLEARANCE;
  const a0 = Math.asin(Math.min(0.95, (CUP_RADIUS * 0.85) / ry));
  const steps = 44;
  const bandPts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((Math.PI - 2 * a0) * i) / steps;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = 2 / BAND_SQUARE;
    bandPts.push([rx * Math.sign(c) * Math.abs(c) ** e, cy + ry * Math.sign(s) * Math.abs(s) ** e, cz - BAND_SETBACK * s]);
  }
  g.add(mesh(tubeAlong(bandPts, 0.034, { tubular: 140, radial: 16 }), MAT.blue, "band"));
  const padPts = bandPts.filter((_, i) => i > 14 && i < 30).map(([x, y, z]) => [x * 0.985, y - 0.036, z]);
  g.add(mesh(tubeAlong(padPts, 0.024, { tubular: 40, radial: 12 }), MAT.whiteGloss, "band-pad"));
  for (const [idx, sign] of [
    [0, 1],
    [steps, -1],
  ]) {
    const [x, y, z] = bandPts[idx];
    const slider = mesh(roundedCylY(0.046, -0.06, 0.06, 0.014), MAT.metal, "slider");
    put(slider, x - sign * 0.0, y - 0.03, z);
    g.add(slider);
  }
  return makeProp("listening", "worn", g, { meta: { frame: "nx-head", note: "attach as a child of nx-head (pos 0)" } });
}
