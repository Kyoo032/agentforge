// Nultron 3D materials (owner: modeller). Glossy vinyl / clay toy: physical materials with clearcoat, satin face plate.
// Colours start from the palette listed in CONTRACT.md (sampled from the reference sheet); record any retuning there. Runs under node too (textures are
// only created when a DOM exists).
import * as THREE from "three";

export const PALETTE = {
  blue: "#2688C8",
  blueDeep: "#15559A",
  blueSoft: "#BFDFF3",
  face: "#F6E7D6",
  white: "#F8F2E8",
  joint: "#232427",
  eye: "#212220",
  glow: "#38C6DE",
  glowSoft: "#ACEFEF",
  blush: "#F4A3A3",
  ink: "#3B3B3D",
};

const hasDOM = typeof document !== "undefined";

/** Soft radial-gradient CanvasTexture (alpha falls off to 0 at the rim); null under node. */
export function radialTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)", size = 256, power = 1) {
  if (!hasDOM) return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const stops = 12;
  const a = parseRgba(inner);
  const b = parseRgba(outer);
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    const k = t ** power;
    grad.addColorStop(t, `rgba(${lerpN(a[0], b[0], k)},${lerpN(a[1], b[1], k)},${lerpN(a[2], b[2], k)},${lerpN(a[3], b[3], k).toFixed(4)})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const parseRgba = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/)[1].split(",").map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
};
const lerpN = (a, b, t) => Math.round(a + (b - a) * t);

const std = (params) => new THREE.MeshPhysicalMaterial(params);

/** Blue vinyl: the helmet, chest, limbs, boots. */
const blue = std({
  color: new THREE.Color("#2d7dc9"),
  roughness: 0.42,
  metalness: 0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.3,
  sheen: 0.0,
});
blue.name = "nx-mat-blue";

const blueDeep = std({ color: PALETTE.blueDeep, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.25 });
blueDeep.name = "nx-mat-blueDeep";

/** Cream face plate: satin, warm, vertex-coloured (the gradient and the soft edge shading are baked into the mesh). */
const face = std({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.5,
  clearcoat: 0.18,
  clearcoatRoughness: 0.45,
  sheen: 0.4,
  sheenColor: new THREE.Color("#ffd9c4"),
  sheenRoughness: 0.6,
});
face.name = "nx-mat-face";

/** Belly and badge: off-white satin vinyl. */
const white = std({
  color: PALETTE.white,
  roughness: 0.42,
  clearcoat: 0.35,
  clearcoatRoughness: 0.3,
  sheen: 0.3,
  sheenColor: new THREE.Color("#fff1de"),
  sheenRoughness: 0.6,
});
white.name = "nx-mat-white";

/** Glossy black ball joints. */
const joint = std({ color: PALETTE.joint, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06 });
joint.name = "nx-mat-joint";

/** Eyes: black mirror. The catchlights are separate white meshes. */
const eye = std({ color: "#060708", roughness: 0.2, clearcoat: 0, specularIntensity: 0.06, envMapIntensity: 0.1 });
eye.name = "nx-mat-eye";

const catchlight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false });
catchlight.name = "nx-mat-catchlight";

/** Gem: the emissive core, and the glass shell over it. */
const gemGlow = new THREE.MeshStandardMaterial({
  color: PALETTE.glow,
  emissive: new THREE.Color(PALETTE.glow),
  emissiveIntensity: 2.2,
  roughness: 0.4,
});
gemGlow.name = "nx-mat-gemGlow";

const gemShell = std({
  color: new THREE.Color("#4fd6ee"),
  roughness: 0.04,
  metalness: 0,
  transparent: true,
  opacity: 0.3,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  envMapIntensity: 1.1,
  depthWrite: false,
});
gemShell.name = "nx-mat-gemShell";

const gemFacet = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
gemFacet.name = "nx-mat-gemFacet";

const gemCore = new THREE.MeshBasicMaterial({ color: new THREE.Color("#8ff2ff").multiplyScalar(3.2), toneMapped: false });
gemCore.name = "nx-mat-gemCore";

const gemSwirl = new THREE.MeshBasicMaterial({ color: new THREE.Color("#c4fbff").multiplyScalar(2.4), toneMapped: false });
gemSwirl.name = "nx-mat-gemSwirl";

const blushTex = radialTexture("rgba(255,255,255,0.92)", "rgba(255,255,255,0)", 256, 1.7);
const blush = new THREE.MeshBasicMaterial({
  color: PALETTE.blush,
  transparent: true,
  opacity: blushTex ? 0.36 : 0.3,
  alphaMap: blushTex ? toAlphaTex(blushTex) : null,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
blush.name = "nx-mat-blush";
function toAlphaTex(tex) {
  // alphaMap reads the green channel; the radial gradient stores its falloff in alpha, so bake it into greyscale
  const c = document.createElement("canvas");
  const src = tex.image;
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

const ink = std({ color: new THREE.Color("#443a3d"), roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.25 });
ink.name = "nx-mat-ink";

/** Prop materials. */
const metal = std({ color: "#c9ced6", metalness: 1, roughness: 0.28, envMapIntensity: 1.2 });
metal.name = "nx-mat-metal";

const glassHolo = std({
  color: new THREE.Color("#a6ecf6"),
  roughness: 0.12,
  transmission: 0.7,
  thickness: 0.04,
  ior: 1.3,
  transparent: true,
  opacity: 0.92,
  iridescence: 0.5,
  emissive: new THREE.Color(PALETTE.glow),
  emissiveIntensity: 0.25,
  side: THREE.DoubleSide,
});
glassHolo.name = "nx-mat-glassHolo";

/** Antenna ball: brighter, glassier blue than the vinyl. */
const antennaBall = std({
  color: new THREE.Color("#1f97e4"),
  roughness: 0.1,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  emissive: new THREE.Color("#0f78d2"),
  emissiveIntensity: 0.35,
  sheen: 0.5,
  sheenColor: new THREE.Color("#8fdcff"),
  sheenRoughness: 0.4,
  envMapIntensity: 1.3,
});
antennaBall.name = "nx-mat-antennaBall";

/** Lighter blue for the ear-pod rings. */
const earRing = std({ color: new THREE.Color("#5fb3ea"), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.18 });
earRing.name = "nx-mat-earRing";

/** Darker cream for the badge outline. */
const badgeLine = std({ color: new THREE.Color("#cdbda6"), roughness: 0.5, clearcoat: 0.2 });
badgeLine.name = "nx-mat-badgeLine";

/** The "N": a slightly lighter, slightly satin blue. */
const badgeN = std({ color: new THREE.Color("#3a9ad8"), roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.25 });
badgeN.name = "nx-mat-badgeN";

export const MAT = {
  blue,
  blueDeep,
  face,
  white,
  joint,
  eye,
  gemGlow,
  blush,
  ink,
  metal,
  glassHolo,
  // extras used by character.js (props may use them too)
  catchlight,
  gemShell,
  gemFacet,
  gemCore,
  gemSwirl,
  antennaBall,
  earRing,
  badgeLine,
  badgeN,
};
