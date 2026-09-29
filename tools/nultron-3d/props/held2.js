// Hand-held props, part 2: painting, filming, editing, presenting. Same conventions as held1.js.
import {
  THREE,
  cylY,
  deg,
  extrude,
  frameShape,
  lathe,
  mesh,
  node,
  put,
  roundedCylY,
  slab,
  sphere,
} from "./kit.js";
import { glowPlane, makeProp } from "./parts.js";
import { MAT, PALETTE, glowMat, paint } from "./mats.js";
import { clapBoardTex, clapStripeTex } from "./tex.js";
import { boardPanel, pictureFrame } from "./panels.js";

// ---------------------------------------------------------------------------------------------------------------------
// painting: brush in the left hand, the rocket picture floating beside it
// ---------------------------------------------------------------------------------------------------------------------

function brushGeometry() {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push([0.031 * Math.sin(a), -0.24 - 0.035 * Math.cos(a) + 0.035]);
  }
  // belly then slim neck toward the ferrule
  const prof = [
    [0.031, -0.205],
    [0.037, -0.13],
    [0.041, -0.05],
    [0.037, 0.03],
    [0.029, 0.13],
    [0.023, 0.2],
  ];
  return lathe([...pts.map((p) => [p[0], p[1]]), ...prof]);
}

export function painting() {
  const brush = node("brush");
  brush.add(mesh(brushGeometry(), MAT.whiteGloss, "handle"));
  brush.add(mesh(roundedCylY(0.0425, -0.115, -0.08, 0.008), MAT.blue, "handle-band"));
  brush.add(mesh(roundedCylY(0.027, 0.2, 0.3, 0.006), MAT.metal, "ferrule"));
  brush.add(mesh(roundedCylY(0.0285, 0.235, 0.245, 0.003), MAT.blueDeep, "ferrule-ring"));
  const bristle = mesh(
    lathe([
      [0, 0.298],
      [0.026, 0.3],
      [0.032, 0.33],
      [0.027, 0.375],
      [0.015, 0.415],
      [0.0, 0.445],
    ]),
    paint(PALETTE.face, { roughness: 0.6, clearcoat: 0.1 }),
    "bristles",
  );
  brush.add(bristle);
  const dip = mesh(
    lathe([
      [0, 0.36],
      [0.0275, 0.372],
      [0.0165, 0.412],
      [0.0, 0.446],
    ]),
    paint(PALETTE.glow, { emissive: PALETTE.glow, emissiveIntensity: 0.35, roughness: 0.3 }),
    "paint-tip",
  );
  brush.add(dip);
  // the picture floats beside the brush (hide it with `hide: ["picture"]` to place it on its own)
  const picture = pictureFrame();
  put(picture, 0.5, 0.36, -0.06, deg(2), deg(-16), deg(4));
  return makeProp("painting", "held", [brush, picture], {
    hands: "l",
    meta: { tip: [0, 0.44, 0], companions: ["picture"] },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// filming: clapperboard, two hands
// ---------------------------------------------------------------------------------------------------------------------

export function filming() {
  const W = 0.5;
  const H = 0.34;
  const D = 0.054;
  const g = node("clapperboard");
  const face = D / 2;
  g.add(mesh(slab(W, H, D, { r: 0.028, bevel: 0.01 }), MAT.joint, "board"));
  const boardFace = mesh(
    new THREE.PlaneGeometry(W - 0.03, H - 0.075),
    new THREE.MeshStandardMaterial({ map: clapBoardTex(), roughness: 0.55, metalness: 0 }),
    "board-face",
  );
  put(boardFace, 0, -0.026, face + 0.0008);
  g.add(boardFace);
  const stripeTex = clapStripeTex();
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5, metalness: 0 });
  // fixed strip along the top of the board
  const fixed = mesh(new THREE.PlaneGeometry(W - 0.03, 0.05), stripeMat, "strip-fixed");
  put(fixed, 0, H / 2 - 0.036, face + 0.0008);
  g.add(fixed);
  // hinged arm, opened a little
  const arm = node("arm");
  arm.add(mesh(slab(W, 0.062, D, { r: 0.02, bevel: 0.009 }), MAT.joint, "arm-body"));
  const armStripe = mesh(new THREE.PlaneGeometry(W - 0.024, 0.046), stripeMat, "arm-stripe");
  put(armStripe, 0, 0, face + 0.0008);
  arm.add(armStripe);
  put(arm, 0, 0, 0);
  const hingeX = -W / 2 + 0.024;
  const hingeY = H / 2 + 0.008;
  const pivot = node("arm-pivot", arm);
  arm.position.set(W / 2 - 0.024, 0.026, 0);
  pivot.position.set(hingeX, hingeY, 0);
  pivot.rotation.z = deg(14);
  g.add(pivot);
  const pin = mesh(cylY(0.014, 0.014, -0.028, 0.028, 24).rotateX(Math.PI / 2), paint(PALETTE.glow, { emissive: PALETTE.glow, emissiveIntensity: 0.5 }), "hinge");
  put(pin, hingeX, hingeY, 0);
  g.add(pin);
  const glow = glowPlane(0.8, PALETTE.glow, 0.1);
  put(glow, 0, 0.02, -0.06);
  g.add(glow);
  return makeProp("filming", "held", g, {
    hands: "lr",
    grip: [0, 0, 0],
    gripL: [-0.21, 0, 0],
    gripR: [0.21, 0, 0],
    meta: { size: [W, H + 0.1, D], note: "attach to body: the origin is the board's centre" },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// editing: scissors (right hand)
// ---------------------------------------------------------------------------------------------------------------------

function bladeShape(side) {
  // side +1: wedge on +x with the straight cutting edge on x = 0
  const pts = [
    [0, 0.39],
    [0.066, 0.03],
    [0.068, -0.035],
    [0, -0.035],
  ].map(([x, y]) => [x * side, y]);
  const s = new THREE.Shape();
  for (const [i, [x, y]] of pts.entries()) {
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function scissorHalf(side, ringMat, z) {
  const half = node(side > 0 ? "half-a" : "half-b");
  const blade = mesh(extrude(bladeShape(side), { depth: 0.01, bevel: 0.005, seg: 3, smooth: true }), MAT.metal, "blade");
  half.add(blade);
  const shank = mesh(slab(0.046, 0.15, 0.026, { r: 0.02, bevel: 0.01, seg: 3 }), ringMat, "shank");
  put(shank, 0, -0.1, 0);
  half.add(shank);
  const ringShape = frameShape(0.13, 0.15, 0.062, 0.034);
  const ring = mesh(extrude(ringShape, { depth: 0.02, bevel: 0.009, seg: 4 }), ringMat, "ring");
  put(ring, 0, -0.245, 0);
  half.add(ring);
  half.position.z = z;
  return half;
}

export function editing() {
  const g = node("scissors");
  const open = deg(17);
  const a = scissorHalf(1, MAT.blue, 0.011);
  const b = scissorHalf(-1, MAT.whiteGloss, -0.011);
  const pivot = node("pivot", a, b);
  a.rotation.z = -open;
  b.rotation.z = open;
  g.add(pivot);
  const screw = mesh(sphere(0.017, 20), paint(PALETTE.glow, { emissive: PALETTE.glow, emissiveIntensity: 0.6 }), "screw");
  screw.scale.z = 0.6;
  put(screw, 0, 0, 0.026);
  g.add(screw);
  return makeProp("editing", "held", g, {
    hands: "r",
    grip: [0, -0.1, 0],
    meta: { tip: [0, 0.39, 0], blades: "open 30 degrees" },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// presenting: telescopic pointer, a holo board floating beside it
// ---------------------------------------------------------------------------------------------------------------------

export function presenting() {
  const p = node("pointer");
  p.add(mesh(roundedCylY(0.037, -0.17, 0.22, 0.016), MAT.blueGloss, "handle"));
  p.add(mesh(roundedCylY(0.042, -0.125, -0.02, 0.012), MAT.blueDeep, "grip-band"));
  const btn = mesh(sphere(0.012, 16), glowMat(PALETTE.glow), "button");
  put(btn, 0, 0.08, 0.036);
  btn.scale.z = 0.6;
  p.add(btn);
  p.add(mesh(roundedCylY(0.028, 0.22, 0.47, 0.007), MAT.metal, "mid"));
  p.add(mesh(roundedCylY(0.021, 0.47, 0.7, 0.006), MAT.whiteGloss, "top"));
  for (const y of [0.22, 0.47]) p.add(put(mesh(roundedCylY(0.0425, y - 0.014, y + 0.014, 0.005), MAT.blueDeep, "collar"), 0, 0, 0));
  const tip = mesh(sphere(0.033, 24), paint(PALETTE.glow, { emissive: PALETTE.glow, emissiveIntensity: 0.75, roughness: 0.25 }), "tip");
  tip.position.y = 0.72;
  p.add(tip);
  const tipGlow = glowPlane(0.2, PALETTE.glow, 0.55);
  put(tipGlow, 0, 0.72, 0.03);
  p.add(tipGlow);
  // the holo board floats beside the pointer (hide it with `hide: ["board"]` to place it on its own)
  const board = boardPanel();
  put(board, 0.62, 0.62, -0.08, 0, deg(-14), deg(2));
  return makeProp("presenting", "held", [p, board], {
    hands: "r",
    meta: { tip: [0, 0.75, 0], companions: ["board"] },
  });
}

