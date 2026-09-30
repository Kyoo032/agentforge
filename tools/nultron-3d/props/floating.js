// Floating props: charging (pad + rings), love (the balloon heart), and the standalone decorative pieces.
import { THREE, deg, mesh, node, put, slab, sphere } from "./kit.js";
import { glowPlane, holoBand, makeProp } from "./parts.js";
import { MAT, PALETTE, glowMat, paint } from "./mats.js";
import { boardPanel, chartScreen, holoCardsBody, holoRingBody, pictureFrame, tabletBody } from "./panels.js";

// ---------------------------------------------------------------------------------------------------------------------
// charging: white base pad under the feet (top face at y = 0) and glowing cyan rings around the body
// ---------------------------------------------------------------------------------------------------------------------

export function charging() {
  const padW = 1.0;
  const padD = 0.68;
  const padH = 0.17;
  const g = node("charging");

  const pad = node("pad");
  const shell = mesh(slab(padW, padD, padH, { r: 0.17, bevel: 0.04, seg: 6 }), MAT.whiteGloss, "shell");
  put(shell, 0, -padH / 2, 0, -Math.PI / 2, 0, 0);
  pad.add(shell);
  const plate = mesh(slab(padW - 0.2, padD - 0.2, 0.024, { r: 0.11, bevel: 0.01 }), paint("#dfeaf4", { roughness: 0.3, clearcoat: 0.9 }), "plate");
  put(plate, 0, 0.003, 0, -Math.PI / 2, 0, 0);
  pad.add(plate);
  const inlay = mesh(new THREE.TorusGeometry(0.34, 0.009, 10, 80), glowMat(PALETTE.glow), "inlay");
  put(inlay, 0, 0.016, 0, -Math.PI / 2, 0, 0);
  inlay.scale.set(1.5, 0.92, 1);
  pad.add(inlay);
  const housing = mesh(slab(0.3, 0.1, 0.03, { r: 0.05, bevel: 0.01 }), MAT.blueDeep, "pill-housing");
  put(housing, 0, -padH * 0.5, padD / 2 + 0.002);
  pad.add(housing);
  const pill = mesh(slab(0.22, 0.056, 0.024, { r: 0.028, bevel: 0.008 }), paint(PALETTE.glow, { emissive: PALETTE.glow, emissiveIntensity: 0.9, roughness: 0.25 }), "pill");
  put(pill, 0, -padH * 0.5, padD / 2 + 0.017);
  pad.add(pill);
  const floor = glowPlane(1.5, PALETTE.glow, 0.42);
  put(floor, 0, 0.012, 0, -Math.PI / 2, 0, 0);
  pad.add(floor);
  g.add(pad);

  const rings = node("rings");
  [
    { y: 0.16, R: 0.6, h: 0.06, o: 0.3, name: "ring-low" },
    { y: 0.46, R: 0.68, h: 0.09, o: 0.42, name: "ring-mid" },
    { y: 0.9, R: 0.72, h: 0.09, o: 0.42, name: "ring-high" },
  ].forEach(({ y, R, h, o, name }, i) => {
    const b = holoBand({ R, h, opacity: o, name });
    put(b, 0, y, 0, deg(i % 2 ? -3 : 3), deg(i * 40), 0);
    rings.add(b);
  });
  const motes = [
    [0.42, 0.7, 0.3, 0.02],
    [-0.5, 1.15, 0.2, 0.014],
    [0.52, 1.3, -0.2, 0.016],
    [-0.36, 0.32, 0.5, 0.012],
    [0.05, 1.5, 0.42, 0.011],
    [-0.6, 0.72, -0.15, 0.015],
  ];
  motes.forEach(([x, y, z, r], i) => {
    const m = mesh(sphere(r, 14), glowMat(PALETTE.glowSoft), `mote-${i}`);
    m.position.set(x, y, z);
    rings.add(m);
  });
  g.add(rings);
  return makeProp("charging", "float", g, {
    anchor: [0, 0, 0],
    meta: { size: [padW, 1.5, padD], parts: ["pad", "rings"], note: "the pad's top face is y = 0; its body hangs below the ground plane" },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// love: the big glossy blue heart, held in both hands
// ---------------------------------------------------------------------------------------------------------------------

function heartContour(W, samples) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.3 * W);
  s.bezierCurveTo(-0.1 * W, 0.52 * W, -0.5 * W, 0.5 * W, -0.5 * W, 0.14 * W);
  s.bezierCurveTo(-0.5 * W, -0.18 * W, -0.16 * W, -0.3 * W, 0, -0.5 * W);
  s.bezierCurveTo(0.16 * W, -0.3 * W, 0.5 * W, -0.18 * W, 0.5 * W, 0.14 * W);
  s.bezierCurveTo(0.5 * W, 0.5 * W, 0.1 * W, 0.52 * W, 0, 0.3 * W);
  return s.getSpacedPoints(samples).slice(0, samples);
}

/**
 * A puffy heart lofted from its own outline: every ring is the outline scaled toward the centre along a superellipse, so
 * the faces are flat-ish and the rim is round (a balloon, not a cookie cutter). Smooth normals, no seams.
 */
export function heartGeometry(W = 0.62, halfThick = 0.15, { around = 200, across = 44, n = 2.5 } = {}) {
  const contour = heartContour(W, around);
  const c = new THREE.Vector2(0, 0.045 * W);
  const pos = [];
  for (let j = 0; j <= across; j++) {
    const u = -1 + (2 * j) / across;
    const s = Math.max(0, 1 - Math.abs(u) ** n) ** (1 / n);
    for (let i = 0; i < around; i++) {
      const p = contour[i];
      pos.push(c.x + (p.x - c.x) * s, c.y + (p.y - c.y) * s, halfThick * u);
    }
  }
  const idx = [];
  for (let j = 0; j < across; j++) {
    for (let i = 0; i < around; i++) {
      const a = j * around + i;
      const b = j * around + ((i + 1) % around);
      const c2 = (j + 1) * around + i;
      const d = (j + 1) * around + ((i + 1) % around);
      idx.push(a, b, c2, b, d, c2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, contour, centre: c };
}

/** Half-width of the heart outline at height y (metres in prop space). */
function halfWidthAt(contour, y) {
  let best = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) {
      const t = (y - a.y) / (b.y - a.y);
      best = Math.max(best, Math.abs(a.x + (b.x - a.x) * t));
    }
  }
  return best;
}

export function love() {
  const W = 0.72;
  const { geo, contour } = heartGeometry(W, 0.17);
  const heart = mesh(geo, MAT.blueGloss, "heart");
  // the heart's own centre is the group origin (the poser attaches it to nx-body)
  const gy = -0.03;
  const gx = halfWidthAt(contour, gy) - 0.005;
  const g = node("heart-group", heart);
  const glow = glowPlane(1.1, PALETTE.glow, 0.13);
  put(glow, 0, 0, -0.16);
  g.add(glow);
  return makeProp("love", "held", g, {
    hands: "lr",
    grip: [0, 0, 0],
    gripL: [-gx, gy, 0],
    gripR: [gx, gy, 0],
    meta: { size: [W, W * 0.94, 0.3], note: "attach to body: the origin is the heart's centre" },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// decorative pieces as standalone props (the hero's ring and cards, and the panels other props carry)
// ---------------------------------------------------------------------------------------------------------------------

/** The floating holo bar-chart screen the pointing hand aims at (a little larger than the panel's design size). */
export function charting() {
  const s = chartScreen();
  s.scale.setScalar(1.3);
  return makeProp("charting", "float", s, { meta: { size: [0.6, 0.42, 0.01] } });
}

export const holoRing = () => makeProp("holo-ring", "float", holoRingBody(), { meta: { size: [0.9, 0.9, 0.4] } });
export const holoCards = () => makeProp("holo-cards", "float", holoCardsBody(), { meta: { size: [0.9, 0.7, 0.1] } });
export const picture = () => makeProp("picture", "float", pictureFrame(), { meta: { size: [0.7, 0.58, 0.055] } });
export const board = () => makeProp("board", "float", boardPanel(), { meta: { size: [0.78, 0.54, 0.01] } });
export const chartingScreen = () => makeProp("charting-screen", "float", chartScreen(), { meta: { size: [0.46, 0.32, 0.01] } });
export const tablet = () => makeProp("tablet", "float", tabletBody(), { meta: { size: [0.44, 0.3, 0.032] } });
