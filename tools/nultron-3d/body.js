// Nultron body (owner: modeller): torso, badge, arms, legs. Every node sits at its joint (contract pivots).
import * as THREE from "three";
import { L, SIDES } from "./layout.js";
import { MAT } from "./materials.js";
import * as G from "./geo.js";
import { buildHand } from "./hands.js";

const T = L.torso;
const named = (o, n) => {
  o.name = n;
  return o;
};
const mesh = (geo, mat) => {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

// ---- torso profile (r, y in WORLD units); an egg: narrow collar, full belly ----
const TORSO_CTRL = [
  [0, T.yBottom],
  [0.125, T.yBottom + 0.007],
  [0.24, 0.468],
  [0.322, 0.52],
  [0.362, 0.59],
  [0.372, 0.655],
  [0.362, 0.73],
  [0.34, 0.815],
  [0.318, 0.895],
  [0.3, 0.965],
  [0.278, 1.025],
  [0.245, 1.07],
  [0.19, 1.098],
  [0, T.yTop],
];
const torsoProfile = G.splineProfile(TORSO_CTRL, 200);
/** Torso radius at height y, from the sampled profile. */
export function torsoR(y) {
  const p = torsoProfile;
  if (y <= p[0].y) return p[0].x;
  for (let i = 1; i < p.length; i++) {
    if (p[i].y >= y) {
      const t = (y - p[i - 1].y) / (p[i].y - p[i - 1].y || 1);
      return p[i - 1].x + (p[i].x - p[i - 1].x) * t;
    }
  }
  return 0;
}
/** Height of the belly front surface above (x, y): cap step included. */
export function torsoFrontZ(x, y) {
  const r = torsoR(y);
  const z = r * r - x * x > 0 ? T.zScale * Math.sqrt(r * r - x * x) : 0;
  return z + T.capLift * G.smoothstep(T.splitY - 0.006, T.splitY + 0.006, y);
}

function badgeShape(w, h, s, t, round) {
  const pts = [
    [0, 0],
    [s, 0],
    [s, h - t],
    [w - s, 0],
    [w, 0],
    [w, h],
    [w - s, h],
    [w - s, t],
    [s, h],
    [0, h],
  ];
  return G.roundedPolygonShape(pts, round);
}

function buildTorso(body) {
  const hip = L.hipY;
  const belly = named(mesh(G.latheSmooth(torsoProfile, { segs: 160, zScale: T.zScale }), MAT.white), "nx-torso");
  belly.geometry.translate(0, -hip, 0);
  body.add(belly);

  // blue chest cap: a shell a hair proud of the belly, with a rounded lip along the split line
  const rB = torsoR(T.splitY);
  const lift = T.capLift;
  const cap = [new THREE.Vector2(rB - 0.006, T.splitY - 0.008), new THREE.Vector2(rB + lift * 0.12, T.splitY - 0.0045)];
  cap.push(new THREE.Vector2(rB + lift * 0.62, T.splitY - 0.0005), new THREE.Vector2(rB + lift * 0.95, T.splitY + 0.0055));
  for (const p of torsoProfile) if (p.y > T.splitY + 0.012) cap.push(new THREE.Vector2(p.x + lift, p.y));
  const chest = mesh(G.latheSmooth(cap, { segs: 160, zScale: T.zScale }), MAT.blue);
  chest.geometry.translate(0, -hip, 0);
  chest.name = "nx-torso-chest";
  belly.add(chest);

  // badge: cream disc conforming to the front, an outline ring and the extruded "N"
  const badge = named(new THREE.Group(), "nx-badge");
  const R = L.badge.r;
  const by = L.badge.y;
  const H = 0.017;
  const edge = (s) => (s < 0.86 ? 1 : Math.sqrt(Math.max(0, 1 - ((s - 0.86) / 0.14) ** 2)));
  const disc = G.polarPatch({
    outlineFn: (t) => [R * Math.cos(t), by + R * Math.sin(t)],
    centre: [0, by],
    rings: 28,
    around: 96,
    zFn: (x, y, s) => torsoFrontZ(x, y) + H * edge(s) + 0.0006,
  });
  disc.translate(0, -hip, 0);
  badge.add(mesh(disc, MAT.white));
  const ringPts = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    const x = R * 0.985 * Math.cos(a);
    const y = by + R * 0.985 * Math.sin(a);
    ringPts.push(new THREE.Vector3(x, y - hip, torsoFrontZ(x, y) + 0.0032));
  }
  badge.add(mesh(G.tubeAlong(ringPts, 0.0042, { closed: true, tubular: 256, radial: 8 }), MAT.badgeLine));

  const nw = 0.108;
  const nh = 0.13;
  const shape = badgeShape(nw, nh, 0.031, 0.05, 0.014);
  const ng = new THREE.ExtrudeGeometry(shape, {
    depth: 0.008,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 4,
    curveSegments: 10,
  });
  ng.translate(-nw / 2, -nh / 2, 0);
  const nMesh = mesh(ng, MAT.badgeN);
  nMesh.name = "nx-badge-n";
  nMesh.position.set(0, by - hip + 0.001, torsoFrontZ(0, by) + H - 0.001);
  badge.add(nMesh);
  body.add(badge);
}

function buildArm(body, side) {
  const { id, sx } = side;
  const S = L.shoulder;
  const shoulder = named(mesh(new THREE.SphereGeometry(S.r, 48, 36), MAT.joint), `nx-shoulder-${id}`);
  shoulder.position.set(sx * S.x, S.y - L.hipY, 0);
  body.add(shoulder);

  const upperGeo = G.sleeve(L.arm.upper - 0.06, [
    [0, L.arm.rUpper],
    [0.55, L.arm.rUpper * 1.03],
    [1, L.arm.rUpper],
  ]);
  upperGeo.translate(0, -0.06, 0);
  const upper = named(mesh(upperGeo, MAT.blue), `nx-upperarm-${id}`);
  shoulder.add(upper);

  const elbow = named(new THREE.Group(), `nx-elbow-${id}`);
  elbow.position.set(0, -L.arm.upper, 0);
  upper.add(elbow);

  const foreGeo = G.sleeve(L.arm.fore, [
    [0, L.arm.rUpper],
    [0.5, L.arm.rFore * 1.02],
    [1, L.arm.rFore * 0.9],
  ]);
  const fore = named(mesh(foreGeo, MAT.blue), `nx-forearm-${id}`);
  elbow.add(fore);

  const hand = named(new THREE.Group(), `nx-hand-${id}`);
  hand.position.set(0, -L.arm.fore, 0);
  fore.add(hand);
  buildHand(hand, id);
}

function buildLeg(body, side) {
  const { id, sx } = side;
  const Hp = L.hip;
  const B = L.boot;
  const hip = named(mesh(new THREE.SphereGeometry(Hp.r, 48, 36), MAT.joint), `nx-hip-${id}`);
  hip.position.set(sx * Hp.x, Hp.y - L.hipY, 0);
  body.add(hip);

  const hx = sx * Hp.x;
  const hy = Hp.y;
  const legG = G.superGeometry({ rx: B.rx, ry: B.ry, rz: B.rz, e1: 0.82, e2: 0.92 }, 96, 72);
  legG.translate(sx * B.x - hx, B.cy - hy, B.cz);
  const leg = named(mesh(legG, MAT.blue), `nx-leg-${id}`);
  hip.add(leg);

  const footG = G.superGeometry({ rx: B.rx - 0.06, ry: 0.06, rz: 0.12, e1: 0.8, e2: 0.9 }, 96, 48);
  footG.translate(sx * B.x - hx, 0.064 - hy, B.cz + 0.11);
  const foot = named(mesh(footG, MAT.blue), `nx-foot-${id}`);
  leg.add(foot);
}

export function buildBody(body) {
  buildTorso(body);
  for (const s of SIDES) {
    buildArm(body, s);
    buildLeg(body, s);
  }
}

/** The neck pivot: a short dark column, mostly hidden under the helmet and the collar. */
export function buildNeck() {
  return named(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 40), MAT.joint), "nx-neck");
}
