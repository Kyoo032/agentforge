// Hand-held props, part 1: writing, searching, calculating, charting, reviewing.
// Design units: a mitt radius of 0.09 (makeProp rescales to dims.json's mittRadius). The grip point is the group origin,
// +Y runs along the handle toward the working end, +Z is the prop's face.
import {
  THREE,
  capsuleY,
  cylY,
  deg,
  extrude,
  lathe,
  mesh,
  node,
  put,
  rrShape,
  ribbonShape,
  roundedCylY,
  slab,
  sphere,
} from "./kit.js";
import { glowPlane, makeProp } from "./parts.js";
import { MAT, PALETTE, glassMat, glowMat, paint } from "./mats.js";
import { chartScreen, tabletBody } from "./panels.js";
import { paperTex, segDisplayTex } from "./tex.js";

// ---------------------------------------------------------------------------------------------------------------------
// writing: the hero's white stylus (the tablet is its own prop)
// ---------------------------------------------------------------------------------------------------------------------

function stylusGeometry() {
  const R = 0.046;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push([R * Math.sin(a), -0.16 - 0.06 * Math.cos(a)]);
  }
  pts.push([R, 0.22]);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const s = t * t * (3 - 2 * t);
    pts.push([R + (0.015 - R) * s, 0.22 + 0.14 * t]);
  }
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * (Math.PI / 2);
    pts.push([0.015 * Math.cos(a), 0.36 + 0.015 * Math.sin(a)]);
  }
  return lathe(pts.map((p) => [p[0], p[1]]));
}

export function writing() {
  const stylus = node("stylus");
  stylus.add(mesh(stylusGeometry(), MAT.whiteGloss, "shaft"));
  stylus.add(mesh(roundedCylY(0.05, -0.07, 0.085, 0.014), MAT.whiteGloss, "grip-section"));
  stylus.add(mesh(roundedCylY(0.0485, 0.1, 0.126, 0.007), MAT.blueDeep, "band"));
  const tip = mesh(sphere(0.014, 20), glowMat(PALETTE.glow), "tip-led");
  tip.position.y = 0.366;
  stylus.add(tip);
  const tipGlow = glowPlane(0.14, PALETTE.glow, 0.5);
  tipGlow.position.set(0, 0.366, 0.03);
  stylus.add(tipGlow);

  // the tablet floats where the stylus tip touches its screen (hide it with `hide: ["tablet"]` to place it on its own)
  const tablet = tabletBody();
  tablet.rotation.set(deg(28), deg(-16), deg(5));
  const touch = new THREE.Vector3(-0.1, -0.03, 0.0176).applyEuler(tablet.rotation);
  tablet.position.set(0, 0.366, 0).sub(touch);

  return makeProp("writing", "held", [stylus, tablet], {
    hands: "r",
    meta: { tip: [0, 0.372, 0], companions: ["tablet"] },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// searching: magnifier
// ---------------------------------------------------------------------------------------------------------------------

export function searching() {
  const g = node("magnifier");
  g.add(mesh(capsuleY(0.034, -0.19, 0.13), MAT.whiteGloss, "handle"));
  g.add(mesh(roundedCylY(0.0415, -0.12, -0.01, 0.012), MAT.blue, "grip-band"));
  g.add(mesh(cylY(0.034, 0.05, 0.11, 0.18, 32), MAT.whiteGloss, "neck"));
  const cy = 0.35;
  const R = 0.15;
  const rim = mesh(new THREE.TorusGeometry(R + 0.012, 0.028, 20, 72), MAT.blueGloss, "rim");
  rim.position.y = cy;
  g.add(rim);
  const cap = (dir) => {
    const sr = 0.42;
    const geo = new THREE.SphereGeometry(sr, 48, 16, 0, Math.PI * 2, 0, Math.asin(R / sr));
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -sr * Math.cos(Math.asin(R / sr)));
    if (dir < 0) geo.rotateY(Math.PI);
    return geo;
  };
  const lensMat = glassMat({ color: "#a9eef4", opacity: 0.3, roughness: 0.03 });
  for (const d of [1, -1]) {
    const lens = mesh(cap(d), lensMat, "lens");
    lens.position.y = cy;
    lens.renderOrder = 1;
    g.add(lens);
  }
  const glintMat = glowMat("#ffffff", 0.9);
  const arc = new THREE.EllipseCurve(0, 0, 0.115, 0.115, deg(105), deg(165), false, 0);
  const glint = mesh(extrude(ribbonShape(arc, () => 0.009), { depth: 0.002, bevel: 0.002, seg: 2 }), glintMat, "glint");
  put(glint, 0, cy, 0.041);
  glint.renderOrder = 2;
  g.add(glint);
  const dot = mesh(extrude(rrShape(0.02, 0.02, 0.01), { depth: 0.002, bevel: 0.002, seg: 2 }), glintMat, "glint-dot");
  put(dot, -0.07, cy + 0.05, 0.041);
  dot.renderOrder = 2;
  g.add(dot);
  const glow = glowPlane(0.5, PALETTE.glowSoft, 0.2);
  put(glow, 0, cy, -0.05);
  g.add(glow);
  return makeProp("searching", "held", g, { hands: "r", meta: { tip: [0, 0.6, 0] } });
}

// ---------------------------------------------------------------------------------------------------------------------
// calculating: two-handed calculator with a seven-segment display
// ---------------------------------------------------------------------------------------------------------------------

function glyph(kind) {
  // Operator glyphs from bars: + - x =
  const g = node(`glyph-${kind}`);
  const bar = (w, h, rz = 0, y = 0) => {
    const m = mesh(slab(w, h, 0.006, { r: h / 2, bevel: 0.002, seg: 2 }), MAT.whiteGloss, "bar");
    put(m, 0, y, 0, 0, 0, rz);
    return m;
  };
  if (kind === "plus") g.add(bar(0.034, 0.008), bar(0.034, 0.008, Math.PI / 2));
  else if (kind === "minus") g.add(bar(0.034, 0.008));
  else if (kind === "times") g.add(bar(0.036, 0.008, Math.PI / 4), bar(0.036, 0.008, -Math.PI / 4));
  else if (kind === "equals") g.add(bar(0.036, 0.008, 0, 0.011), bar(0.036, 0.008, 0, -0.011));
  return g;
}

export function calculating() {
  const W = 0.42;
  const H = 0.52;
  const D = 0.07;
  const g = node("calculator");
  g.add(mesh(slab(W, H, D, { r: 0.07, bevel: 0.022 }), MAT.whiteGloss, "shell"));
  const face = D / 2;
  const screen = mesh(slab(0.34, 0.125, 0.016, { r: 0.03, bevel: 0.006 }), MAT.screenDark, "screen");
  put(screen, 0, 0.165, face + 0.002);
  g.add(screen);
  const digits = mesh(
    new THREE.PlaneGeometry(0.31, 0.097),
    new THREE.MeshBasicMaterial({ map: segDisplayTex("128"), transparent: true, toneMapped: false }),
    "digits",
  );
  put(digits, 0, 0.165, face + 0.0125);
  g.add(digits);
  const cols = [-0.123, -0.041, 0.041, 0.123];
  const rows = [0.035, -0.047, -0.129, -0.211];
  const keyGeo = slab(0.07, 0.07, 0.026, { r: 0.024, bevel: 0.009, seg: 3, curve: 6 });
  const opGlyphs = ["times", "minus", "plus"];
  rows.forEach((y, ri) => {
    cols.forEach((x, ci) => {
      const isOp = ci === 3 && ri < 3;
      const isEq = ci === 3 && ri === 3;
      const mat = isEq ? paint(PALETTE.glow, { emissive: PALETTE.glow, emissiveIntensity: 0.55, roughness: 0.3 }) : isOp ? MAT.blueDeep : MAT.blue;
      const key = mesh(keyGeo, mat, `key-${ri}-${ci}`);
      put(key, x, y, face + 0.002);
      g.add(key);
      if (isOp || isEq) {
        const gl = glyph(isEq ? "equals" : opGlyphs[ri]);
        put(gl, x, y, face + 0.017);
        g.add(gl);
      }
    });
  });
  const glow = glowPlane(0.8, PALETTE.glow, 0.14);
  put(glow, 0, 0.1, -0.05);
  g.add(glow);
  return makeProp("calculating", "held", g, {
    hands: "lr",
    grip: [0, 0, 0],
    gripL: [-0.2, -0.02, 0],
    gripR: [0.2, -0.02, 0],
    meta: { size: [W, H, D], note: "attach to body: the origin is the calculator's centre" },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// charting: projector puck in the fist, a holo bar-chart screen hovering above it
// ---------------------------------------------------------------------------------------------------------------------

/** Puck-in-fist projector with the screen hovering above it (an alternative reading of the brief). */
export function chartingHeld() {
  const g = node("charting");
  g.add(mesh(roundedCylY(0.064, -0.075, 0.05, 0.016), MAT.whiteGloss, "puck"));
  g.add(mesh(roundedCylY(0.0655, -0.03, -0.01, 0.004), MAT.blue, "puck-band"));
  const top = mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.004, 40), MAT.screenDark, "puck-top");
  top.position.y = 0.0505;
  g.add(top);
  const ring = mesh(new THREE.TorusGeometry(0.036, 0.006, 10, 48), glowMat(PALETTE.glow), "puck-ring");
  put(ring, 0, 0.054, 0, Math.PI / 2, 0, 0);
  g.add(ring);
  const led = mesh(sphere(0.013, 16), glowMat(PALETTE.glowSoft), "puck-led");
  led.position.y = 0.055;
  g.add(led);
  const beam = mesh(
    new THREE.CylinderGeometry(0.2, 0.024, 0.22, 48, 1, true),
    new THREE.MeshBasicMaterial({
      color: PALETTE.glow,
      transparent: true,
      opacity: 0.11,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
    "beam",
  );
  beam.position.y = 0.16;
  beam.renderOrder = 0;
  g.add(beam);
  const screen = chartScreen();
  put(screen, 0, 0.44, 0, deg(-6), 0, 0);
  g.add(screen);
  const halo = glowPlane(0.34, PALETTE.glow, 0.5);
  put(halo, 0, 0.056, 0.02, -Math.PI / 2, 0, 0);
  g.add(halo);
  return makeProp("charting-held", "held", g, { hands: "r", meta: { tip: [0, 0.6, 0] } });
}

// ---------------------------------------------------------------------------------------------------------------------
// reviewing: clipboard with a check badge (left hand)
// ---------------------------------------------------------------------------------------------------------------------

function checkGeometry(scale = 1) {
  // A chunky tick built from two rounded arms.
  const arm = (len, rz, x, y) => {
    const m = mesh(slab(len, 0.03 * scale, 0.02, { r: 0.015 * scale, bevel: 0.007, seg: 3 }), MAT.whiteGloss, "tick-arm");
    put(m, x, y, 0, 0, 0, rz);
    return m;
  };
  const g = node("tick");
  g.add(arm(0.052 * scale, deg(-48), -0.028 * scale, -0.006 * scale));
  g.add(arm(0.104 * scale, deg(50), 0.014 * scale, 0.012 * scale));
  return g;
}

export function reviewing() {
  const W = 0.34;
  const H = 0.44;
  const D = 0.034;
  const g = node("clipboard");
  put(g, 0, 0.15, 0);
  g.add(mesh(slab(W, H, D, { r: 0.05, bevel: 0.012 }), MAT.blue, "board"));
  const paperMat = new THREE.MeshStandardMaterial({ map: paperTex(), roughness: 0.9, metalness: 0 });
  const paper = mesh(new THREE.PlaneGeometry(0.28, 0.373), paperMat, "paper");
  put(paper, 0, -0.012, D / 2 + 0.001);
  g.add(paper);
  const clip = mesh(slab(0.13, 0.07, 0.05, { r: 0.02, bevel: 0.01 }), MAT.metal, "clip");
  put(clip, 0, H / 2 - 0.018, 0.004);
  g.add(clip);
  const clipBar = mesh(slab(0.075, 0.016, 0.056, { r: 0.006, bevel: 0.004, seg: 2 }), MAT.blueDeep, "clip-bar");
  put(clipBar, 0, H / 2 - 0.006, 0.004);
  g.add(clipBar);
  const badge = node("badge");
  badge.add(mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.018, 40).rotateX(Math.PI / 2), MAT.blueGloss, "badge-disc"));
  const tick = checkGeometry(1);
  tick.position.z = 0.011;
  badge.add(tick);
  put(badge, 0.062, -0.075, D / 2 + 0.012);
  g.add(badge);
  return makeProp("reviewing", "held", g, {
    hands: "l",
    meta: { size: [W, H, D], note: "the fist closes on the clipboard's bottom edge" },
  });
}
