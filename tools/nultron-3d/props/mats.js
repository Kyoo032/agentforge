// Materials for the props. The vinyl colours come from the modeller's ../materials.js (MAT.*) when it exists, so a prop
// always matches the character; until then (or for any key it lacks) palette-coloured proxies stand in. The holo, glow
// and paint materials are the props' own.
import * as THREE from "three";

// Sampled from the reference, mirrored from the palette in CONTRACT.md.
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

const vinyl = (hex, extra = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: hex,
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.25,
    ...extra,
  });

const proxies = () => ({
  blue: vinyl(PALETTE.blue),
  blueDeep: vinyl(PALETTE.blueDeep),
  face: vinyl(PALETTE.face, { roughness: 0.55, clearcoat: 0.25 }),
  white: vinyl(PALETTE.white, { roughness: 0.42 }),
  joint: vinyl(PALETTE.joint, { roughness: 0.5, clearcoat: 0.3 }),
  eye: vinyl(PALETTE.eye, { roughness: 0.15, clearcoat: 1 }),
  blush: vinyl(PALETTE.blush, { roughness: 0.6, clearcoat: 0.1 }),
  ink: vinyl(PALETTE.ink),
  metal: new THREE.MeshStandardMaterial({ color: "#cfd8e0", metalness: 0.9, roughness: 0.28 }),
});

let external = null;
try {
  external = (await import("../materials.js")).MAT ?? null;
} catch (err) {
  console.warn("[props] ../materials.js not available, using palette proxies:", err?.message ?? err);
}
export const USING_MODELLER_MATERIALS = external !== null;
const BASE = { ...proxies(), ...(external ?? {}) };

const key = (parts) => parts.join("|");
const cache = new Map();
const memo = (k, make) => {
  if (!cache.has(k)) cache.set(k, make());
  return cache.get(k);
};

/** Flat emissive colour (never tone mapped, never lit): LEDs, glow lines, holo edges. */
export function glowMat(hex = PALETTE.glow, opacity = 1) {
  return memo(key(["glow", hex, opacity]), () =>
    new THREE.MeshBasicMaterial({
      color: hex,
      transparent: opacity < 1,
      opacity,
      toneMapped: false,
      depthWrite: opacity >= 1,
    }),
  );
}

/** Translucent cyan holo glass: a lit, glossy, see-through slab. */
export function glassMat({ color = "#8fe3ee", opacity = 0.22, roughness = 0.08 } = {}) {
  return memo(key(["glass", color, opacity, roughness]), () =>
    new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity,
      roughness,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
}

/** Frosted, whitish-blue glass (the rocket picture's frame). */
export function frostMat(opacity = 0.62) {
  return memo(key(["frost", opacity]), () =>
    new THREE.MeshPhysicalMaterial({
      color: "#e7f3fb",
      transparent: true,
      opacity,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
}

/** A textured, unlit, alpha-blended plane material (holo screen content, paintings). */
export function screenMat(map, { opacity = 1, transparent = true } = {}) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent,
    opacity,
    toneMapped: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** A one-off colour vinyl (paint, stripes, keys) with the same finish as the character's plastic. */
export function paint(hex, extra = {}) {
  return memo(key(["paint", hex, JSON.stringify(extra)]), () => vinyl(hex, extra));
}

export const MAT = {
  ...BASE,
  /** Glossier blue: the balloon heart, lens rims. */
  blueGloss: memo("blueGloss", () => {
    const m = (BASE.blue.clone ? BASE.blue.clone() : vinyl(PALETTE.blue)).clone();
    if ("clearcoat" in m) {
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.08;
    }
    m.roughness = 0.2;
    return m;
  }),
  whiteGloss: memo("whiteGloss", () => {
    const m = BASE.white.clone();
    if ("clearcoat" in m) {
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.1;
    }
    m.roughness = 0.28;
    return m;
  }),
  screenDark: memo("screenDark", () => vinyl("#0c2a52", { roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 })),
  cyanLed: glowMat(PALETTE.glow, 1),
  cyanSoft: glowMat(PALETTE.glowSoft, 1),
  holoGlass: glassMat(),
  holoEdge: glowMat(PALETTE.glow, 0.95),
};
