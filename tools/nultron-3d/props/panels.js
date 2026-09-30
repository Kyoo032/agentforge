// Screens, frames and holo pieces: the rocket picture, the holo board and chart screen, the tablet, and the hero's ring
// and window cards. Each builder returns a Group centred on its own origin, facing +Z.
import { THREE, deg, frameSlab, mesh, node, put, slab, sphere } from "./kit.js";
import { holoBand, holoPanel, glowPlane } from "./parts.js";
import { MAT, PALETTE, frostMat, glowMat } from "./mats.js";
import { boardTex, cardTex, chartTex, rocketTex, tabletTex } from "./tex.js";

/** The rocket picture: a frosted glass frame around a navy starfield with a white rocket (the reference's Attachments). */
export function pictureFrame() {
  const W = 0.7;
  const H = 0.58;
  const D = 0.055;
  const B = 0.06;
  const g = node("picture");
  g.add(mesh(frameSlab(W, H, D, B, { r: 0.1, bevel: 0.018 }), frostMat(0.7), "frame"));
  const pw = W - 2 * B + 0.02;
  const ph = H - 2 * B + 0.02;
  const back = mesh(slab(pw + 0.012, ph + 0.012, 0.014, { r: 0.05, bevel: 0.004 }), MAT.screenDark, "backing");
  back.position.z = -0.012;
  g.add(back);
  const pic = mesh(
    new THREE.PlaneGeometry(pw, ph),
    new THREE.MeshBasicMaterial({ map: rocketTex(), alphaTest: 0.5, toneMapped: false, side: THREE.DoubleSide }),
    "art",
  );
  pic.position.z = -0.003;
  g.add(pic);
  // inner lip: a slim white-blue glossy rim so the frame reads as glass with an edge
  const lip = mesh(frameSlab(W - 2 * B + 0.03, H - 2 * B + 0.03, 0.04, 0.012, { r: 0.05, bevel: 0.004 }), MAT.whiteGloss, "lip");
  lip.position.z = -0.002;
  g.add(lip);
  const halo = glowPlane(Math.max(W, H) * 1.5, PALETTE.glowSoft, 0.28, W / H);
  halo.position.z = -0.06;
  g.add(halo);
  g.userData = { size: [W, H, D] };
  return g;
}

/** The holo presentation board: title, bullets, pie and bars on translucent glass. */
export function boardPanel() {
  const p = holoPanel({ w: 0.78, h: 0.54, r: 0.06, tex: boardTex(), name: "board", opacity: 0.22, glow: 0.36 });
  p.userData = { size: [0.78, 0.54, 0.01] };
  return p;
}

/** The holo chart screen: cyan bars and a trend line. */
export function chartScreen() {
  const p = holoPanel({ w: 0.46, h: 0.32, r: 0.045, tex: chartTex(), name: "charting-screen", opacity: 0.24, glow: 0.4 });
  p.userData = { size: [0.46, 0.32, 0.01] };
  return p;
}

/** The small white tablet with a pen scribble on its screen. */
export function tabletBody() {
  const W = 0.44;
  const H = 0.3;
  const D = 0.032;
  const g = node("tablet");
  g.add(mesh(slab(W, H, D, { r: 0.05, bevel: 0.012 }), MAT.whiteGloss, "shell"));
  const screen = mesh(
    new THREE.PlaneGeometry(W - 0.05, H - 0.05),
    new THREE.MeshBasicMaterial({ map: tabletTex(), alphaTest: 0.5, toneMapped: false }),
    "screen",
  );
  screen.position.z = D / 2 + 0.0008;
  g.add(screen);
  const cam = mesh(sphere(0.006, 16), MAT.joint, "camera");
  cam.position.set(W / 2 - 0.02, 0, D / 2 + 0.001);
  g.add(cam);
  g.userData = { size: [W, H, D] };
  return g;
}

/** The hero's holo ring: a tilted translucent cyan band with tech segments and a glowing trail arc. */
export function holoRingBody() {
  const g = node("holo-ring");
  const band = holoBand({ R: 0.42, h: 0.17, tube: 0.011, opacity: 0.85, name: "band" });
  band.rotation.set(deg(-52), deg(8), deg(-24));
  g.add(band);
  const trail = mesh(
    new THREE.TorusGeometry(0.44, 0.006, 8, 64, deg(110)),
    glowMat(PALETTE.glowSoft, 0.55),
    "trail",
  );
  trail.rotation.set(deg(-52), deg(8), deg(-24 + 200));
  trail.position.set(0, 0, 0);
  g.add(trail);
  const halo = glowPlane(1.2, PALETTE.glow, 0.22);
  halo.position.z = -0.1;
  g.add(halo);
  return g;
}

/** The hero's two floating window cards. */
export function holoCardsBody() {
  const g = node("holo-cards");
  const a = holoPanel({
    w: 0.52,
    h: 0.4,
    r: 0.045,
    tex: cardTex(0),
    name: "card-a",
    tint: "#d3ecf9",
    opacity: 0.34,
    edge: 0.01,
    glow: 0.18,
    inset: 0.94,
  });
  put(a, -0.1, 0.1, -0.02, 0, deg(6), deg(5));
  const b = holoPanel({
    w: 0.46,
    h: 0.34,
    r: 0.04,
    tex: cardTex(1),
    name: "card-b",
    tint: "#d3ecf9",
    opacity: 0.4,
    edge: 0.01,
    glow: 0.18,
    inset: 0.94,
  });
  put(b, 0.13, -0.16, 0.05, 0, deg(6), deg(-3));
  g.add(a, b);
  return g;
}
