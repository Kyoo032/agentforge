// Nultron 3D layout constants (owner: modeller). Every number here is a measurement from the reference sheet
// (a 1932 px character sheet, front view; the repo keeps the sheets in docs/internal/brand/nultron/reference/, and
// sheet-v3-hires.jpg is the closest, at 2000 px): 1 unit = 387.5 px there, ground y = 0, character faces +Z, screen-relative
// left/right (-l is at x < 0). All values are REST-pose values; character.js builds from them and gen-dims.mjs
// publishes them (with measured bounds) as dims.json.
export const L = {
  hipY: 0.44, // nx-body pivot height (hip centre)
  neckY: 1.02, // nx-neck pivot height (under the chin)
  head: {
    center: [0, 1.5, 0], // helmet centre (world); nx-head origin
    rx: 0.63,
    ry: 0.5,
    rz: 0.6,
    egg: 0.0,
    botFlat: 1.0, // full round dome all the way down (volume pass)
  },
  // face-plate window on the helmet front, head-local (x, y); superellipse |x/a|^n + |(y-cy)/b|^n = 1
  // (outline = centre line of the bezel lip; the visible plate is about 0.03 smaller all round)
  // puff = how far the plate's centre stands proud of the helmet surface; cheek = extra fullness at the cheeks
  window: { cx: 0, cy: -0.08, a: 0.575, b: 0.325, n: 2.6, inset: 0.02, lip: 0.06, lipLift: -0.024, puff: 0.055, cheek: 0.026 },
  eye: { x: 0.255, y: -0.055, rx: 0.082, ry: 0.106, lift: 0.034 },
  mouth: { x: -0.01, y: -0.17 },
  blush: { x: 0.37, y: -0.15, rx: 0.165, ry: 0.1 },
  gem: { x: 0, y: 0.26, r: 0.16 },
  antenna: { baseX: 0.055, baseY: 0.5, tipX: 0.17, tipY: 0.255, stem: 0.011, ball: 0.098 },
  ear: { x: 0.645, y: -0.04, z: 0.0, r: 0.155, depth: 0.06 }, // centre of the pod, head-local; +/- x per side
  torso: { yBottom: 0.44, yTop: 1.115, zScale: 0.88, splitY: 0.775, capLift: 0.007 },
  badge: { y: 0.735, r: 0.146 },
  shoulder: { x: 0.415, y: 0.86, r: 0.11 },
  arm: { upper: 0.13, fore: 0.18, rUpper: 0.118, rFore: 0.124 },
  mitt: 0.1,
  hip: { x: 0.21, y: 0.43, r: 0.112 },
  boot: { x: 0.235, cy: 0.185, rx: 0.172, ry: 0.187, rz: 0.205, cz: 0.045 },
};
/** The icon-tile head (buildNultron({tile:true})): a rounded-square helmet with a bigger, rounder plate. Head-local. */
export const TILE = {
  window: { cx: 0, cy: -0.12, a: 0.6, b: 0.4, n: 2.3, inset: 0.02, lip: 0.065, lipLift: -0.026, puff: 0.07, cheek: 0.03 },
  eye: { x: 0.29, y: -0.07, rx: 0.1, ry: 0.128, lift: 0.04 },
  mouth: { x: -0.01, y: -0.21 },
  blush: { x: 0.42, y: -0.17, rx: 0.18, ry: 0.11 },
  gem: { x: 0, y: 0.34, r: 0.2 },
  antenna: { baseX: 0.09, baseY: 0.5, tipX: 0.24, tipY: 0.3, stem: 0.012, ball: 0.112 },
};
export const SIDES = [
  { id: "l", sx: -1 }, // screen-left = -x
  { id: "r", sx: 1 },
];

/** Camera per view (shared by scene.html and dims.json). Perspective, long lens like product photography. */
export const CAMERAS = {
  full: { fov: 20, position: [0, 1.36, 7.7], target: [0, 1.16, 0], note: "full body, front, antenna included" },
  head: { fov: 20, position: [0, 1.62, 5.6], target: [0, 1.56, 0], note: "helmet, ears and antenna" },
  icon: { fov: 14, position: [0, 0.12, 8.2], target: [0, 0.12, 0], note: "tile head for the app icon (buildNultron({tile:true}))" },
};
