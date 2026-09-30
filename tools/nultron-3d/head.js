// Nultron head (owner: modeller): everything that lives under nx-head, in head-local coordinates (origin = helmet centre).
import * as THREE from "three";
import { L, TILE } from "./layout.js";
import { MAT, PALETTE, radialTexture } from "./materials.js";
import * as G from "./geo.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Superquadric parameters for the helmet; `tile` gives the rounded-square app-icon variant. */
export function helmetParams(tile = false) {
  if (tile) return { rx: 0.68, ry: 0.63, rz: 0.62, e1: 0.62, e2: 1, egg: 0.0, botFlat: 1 };
  return { rx: L.head.rx, ry: L.head.ry, rz: L.head.rz, e1: 1, e2: 1, egg: L.head.egg, botFlat: L.head.botFlat };
}

function named(obj, name) {
  obj.name = name;
  return obj;
}
function mesh(geo, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
const sphere = (r, sx = 1, sy = 1, sz = 1, seg = 48) => {
  const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
  g.scale(sx, sy, sz);
  return g;
};

export function buildHead(head, { tile = false } = {}) {
  const P = helmetParams(tile);
  const W = tile ? TILE.window : L.window;
  const E = tile ? TILE.eye : L.eye;
  const M = tile ? TILE.mouth : L.mouth;
  const B = tile ? TILE.blush : L.blush;
  const Gm = tile ? TILE.gem : L.gem;
  const AN = tile ? TILE.antenna : L.antenna;
  const helmetZ = (x, y) => G.superFrontZ(x, y, P);
  // the plate is a puffy cushion: tucked under the bezel at its rim, standing proud of the helmet in the middle, with fuller cheeks and jaw
  const plateZ = (x, y) => {
    const g = G.superellipseG(x, y, W.cx, W.cy, W.a, W.b, W.n);
    const d = G.clamp(-g, 0, 1);
    const dome = 1 - (1 - d) ** 2.2;
    const low = G.clamp((W.cy - y) / W.b, 0, 1);
    const cheek = (W.cheek ?? 0) * Math.exp(-(((Math.abs(x) - 0.36) / 0.17) ** 2)) * Math.exp(-(((y - (W.cy - 0.09)) / 0.15) ** 2));
    return helmetZ(x, y) - W.inset + ((W.puff ?? 0) * (1 + 0.3 * low) + cheek) * dome;
  };
  const winPt = (t) => G.superellipsePoint(t, W.cx, W.cy, W.a, W.b, W.n);
  const surf = { P, helmetZ, plateZ, win: W };

  // ---- helmet: the superquadric shell with the window cut out of the mesh itself ----
  const shell = G.superGeometry(P, tile ? 384 : 224, tile ? 384 : 168);
  const pos = shell.attributes.position;
  const keep = [];
  const ix = shell.index.array;
  for (let i = 0; i < ix.length; i += 3) {
    let inside = 0;
    for (let k = 0; k < 3; k++) {
      const v = ix[i + k];
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      if (z > 0 && G.superellipseG(x, y, W.cx, W.cy, W.a, W.b, W.n) < -0.03) inside++;
    }
    if (inside < 3) keep.push(ix[i], ix[i + 1], ix[i + 2]);
  }
  shell.setIndex(keep);
  const helmet = named(mesh(shell, MAT.blue), "nx-helmet");
  head.add(helmet);

  // bezel: a rolled lip around the window (also hides the cut edge)
  const bez = [];
  const NB = 220;
  for (let i = 0; i < NB; i++) {
    const [x, y] = winPt((2 * Math.PI * i) / NB);
    const n = G.surfaceFrame(helmetZ, x, y, W.lipLift).p;
    bez.push(n);
  }
  const bezel = mesh(G.tubeAlong(bez, W.lip, { closed: true, tubular: 420, radial: 28 }), MAT.blue);
  bezel.name = "nx-bezel";
  helmet.add(bezel);

  // ---- face plate: cream patch on the same curvature, inset under the bezel ----
  const cream = new THREE.Color(PALETTE.face);
  const top = new THREE.Color("#fbf4ea");
  const low = new THREE.Color("#f4d6c6");
  const tmp = new THREE.Color();
  const plateGeo = G.polarPatch({
    outlineFn: winPt,
    centre: [W.cx, W.cy],
    rings: 72,
    around: 200,
    zFn: (x, y) => plateZ(x, y),
    colorFn: (_x, y, s) => {
      const v = G.clamp((y - W.cy) / W.b, -1, 1) * 0.5 + 0.5; // 0 bottom .. 1 top
      // one smooth quadratic blend low -> cream -> top (piecewise lerps left a visible Mach band across the plate)
      tmp.setRGB(
        (1 - v) ** 2 * low.r + 2 * (1 - v) * v * cream.r + v * v * top.r,
        (1 - v) ** 2 * low.g + 2 * (1 - v) * v * cream.g + v * v * top.g,
        (1 - v) ** 2 * low.b + 2 * (1 - v) * v * cream.b + v * v * top.b,
      );
      // soft contact shading under the bezel, stronger at the top (the forehead overhangs)
      const edge = G.smoothstep(0.7, 1.0, s);
      const shade = (1 - edge * (0.03 + 0.03 * G.smoothstep(0.4, 1, v))) * (1.28 + 0.16 * (1 - v));
      return [tmp.r * shade, tmp.g * shade, tmp.b * shade];
    },
  });
  const plate = named(mesh(plateGeo, MAT.face), "nx-faceplate");
  head.add(plate);

  // ---- on-plate helpers ----
  const frame = (x, y, lift = 0) => G.surfaceFrame(plateZ, x, y, lift);
  const plateCurve = (pts2d, lift) => pts2d.map(([x, y]) => frame(x, y, lift).p);
  const tubeCap = (p, r, mat) => {
    const m = mesh(sphere(r, 1, 1, 1, 16), mat, { cast: false });
    m.position.copy(p);
    return m;
  };
  const inkTube = (pts2d, radius, lift = 0.004) => {
    const grp = new THREE.Group();
    const pts = plateCurve(pts2d, lift);
    grp.add(mesh(G.tubeAlong(pts, radius, { tubular: 64, radial: 12 }), MAT.ink, { cast: false }));
    grp.add(tubeCap(pts[0], radius, MAT.ink));
    grp.add(tubeCap(pts[pts.length - 1], radius, MAT.ink));
    return grp;
  };

  // ---- eyes ----
  const eyes = named(new THREE.Group(), "nx-eyes");
  head.add(eyes);
  const eyeBall = (sx, scale = 1, { catchScale = 1 } = {}) => {
    const g = new THREE.Group();
    const f = frame(sx * E.x, E.y, 0);
    g.position.copy(f.p);
    g.quaternion.copy(f.q);
    const rx = E.rx * scale;
    const ry = E.ry * scale;
    const rz = 0.056 * scale;
    const ball = mesh(sphere(1, rx, ry, rz, 64), MAT.eye);
    ball.position.z = rz - E.lift;
    g.add(ball);
    const zAt = (u, v) => ball.position.z + rz * Math.sqrt(Math.max(0, 1 - (u / rx) ** 2 - (v / ry) ** 2));
    const spot = (u, v, a, b, mat = MAT.catchlight) => {
      const zz = zAt(u, v);
      const nrm = V3(u / rx ** 2, v / ry ** 2, (zz - ball.position.z) / rz ** 2).normalize();
      const m = mesh(sphere(1, a, b, 0.004, 24), mat, { cast: false, receive: false });
      m.position.set(u, v, zz - 0.0008);
      m.quaternion.setFromUnitVectors(V3(0, 0, 1), nrm);
      g.add(m);
    };
    spot(-0.27 * rx, 0.4 * ry, 0.3 * rx * catchScale, 0.245 * ry * catchScale);
    spot(0.36 * rx, -0.38 * ry, 0.16 * rx * catchScale, 0.125 * ry * catchScale);
    return g;
  };
  const both = (fn) => {
    const grp = new THREE.Group();
    for (const sx of [-1, 1]) grp.add(fn(sx));
    return grp;
  };
  const variant = (parent, name, grp, visible = false) => {
    grp.name = name;
    grp.visible = visible;
    parent.add(grp);
    return grp;
  };
  variant(eyes, "nx-eyes-open", both((sx) => eyeBall(sx, 1)), true);
  variant(
    eyes,
    "nx-eyes-blink",
    both((sx) => {
      const g = new THREE.Group();
      const f = frame(sx * E.x, E.y - 0.012, 0);
      g.position.copy(f.p);
      g.quaternion.copy(f.q);
      const m = mesh(sphere(1, E.rx * 1.05, 0.016, 0.03, 32), MAT.eye, { cast: false });
      m.position.z = 0.004;
      g.add(m);
      return g;
    }),
  );
  const happyArc = (sx) => {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const u = (i / 20) * 2 - 1;
      pts.push([sx * E.x + E.rx * 1.05 * u, E.y - 0.03 + 0.085 * (1 - u * u)]);
    }
    return inkTube(pts, 0.0165, 0.006);
  };
  variant(eyes, "nx-eyes-happy", both(happyArc));
  // wink (the reference "love" pose): the viewer's left eye stays open, the right one is a happy arc
  variant(eyes, "nx-eyes-wink", (() => {
    const grp = new THREE.Group();
    grp.add(eyeBall(-1, 1));
    grp.add(happyArc(1));
    return grp;
  })());
  variant(eyes, "nx-eyes-surprised", both((sx) => eyeBall(sx, 1.2, { catchScale: 1.25 })));
  variant(
    eyes,
    "nx-eyes-closed",
    both((sx) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const u = (i / 20) * 2 - 1;
        pts.push([sx * E.x + E.rx * 1.0 * u, E.y + 0.02 - 0.06 * (1 - u * u)]);
      }
      return inkTube(pts, 0.0145, 0.006);
    }),
  );

  // ---- mouth ----
  const mouth = named(new THREE.Group(), "nx-mouth");
  head.add(mouth);
  const mouthShape = (cx, cy, halfW, sag) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const u = (i / 24) * 2 - 1;
      pts.push([cx + halfW * u, cy + sag * (u * u)]); // ends up, middle down for sag > 0
    }
    return pts;
  };
  variant(mouth, "nx-mouth-idle", inkTube(mouthShape(M.x, M.y + 0.03, 0.088, 0.04), 0.0098), true);
  variant(mouth, "nx-mouth-smile", inkTube(mouthShape(M.x, M.y + 0.05, 0.122, 0.07), 0.0105));
  variant(mouth, "nx-mouth-sad", inkTube(mouthShape(M.x, M.y - 0.02, 0.07, -0.034), 0.0085));
  variant(mouth, "nx-mouth-sleep", inkTube(mouthShape(M.x, M.y + 0.005, 0.04, 0.012), 0.0078));
  const openMouth = (w, h, tongue) => {
    const g = new THREE.Group();
    const f = frame(M.x, M.y + 0.005, 0);
    g.position.copy(f.p);
    g.quaternion.copy(f.q);
    const dark = new THREE.MeshPhysicalMaterial({ color: "#2a1c20", roughness: 0.5, clearcoat: 0.3 });
    const m = mesh(sphere(1, w, h, 0.02, 40), dark, { cast: false });
    m.position.z = 0.002;
    g.add(m);
    if (tongue) {
      const tg = new THREE.MeshPhysicalMaterial({ color: "#e9788a", roughness: 0.45, clearcoat: 0.3 });
      const t = mesh(sphere(1, w * 0.62, h * 0.5, 0.012, 32), tg, { cast: false });
      t.position.set(0, -h * 0.42, 0.011);
      g.add(t);
    }
    return g;
  };
  variant(mouth, "nx-mouth-talk", openMouth(0.062, 0.05, true));
  variant(mouth, "nx-mouth-o", openMouth(0.04, 0.052, false));

  // ---- blush ----
  const blush = named(new THREE.Group(), "nx-blush");
  head.add(blush);
  for (const sx of [-1, 1]) {
    const cx = sx * B.x;
    const geo = G.polarPatch({
      outlineFn: (t) => [cx + B.rx * Math.cos(t), B.y + B.ry * Math.sin(t)],
      centre: [cx, B.y],
      rings: 8,
      around: 40,
      zFn: (x, y) => plateZ(x, y) + 0.0016,
      uv: true,
    });
    const m = mesh(geo, MAT.blush, { cast: false, receive: false });
    m.renderOrder = 2;
    blush.add(m);
  }

  // ---- ear pods ----
  const A = L.ear;
  for (const [id, sx] of [
    ["l", -1],
    ["r", 1],
  ]) {
    const pod = named(new THREE.Group(), `nx-ear-${id}`);
    pod.position.set(sx * A.x, A.y, A.z);
    pod.rotation.set(0, sx * -0.12, sx * 0.1); // faces slightly forward, top leans in
    // built for +x (outward); mirrored by sign
    const body = mesh(sphere(1, 0.095, A.r, A.r * 0.96, 64), MAT.blue);
    body.position.x = sx * 0.0;
    pod.add(body);
    const ringR = A.r * 0.66;
    const ringX = 0.095 * Math.sqrt(1 - (ringR / A.r) ** 2) - 0.006;
    const ring = mesh(new THREE.TorusGeometry(ringR, 0.0125, 20, 96), MAT.earRing);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = sx * ringX;
    pod.add(ring);
    const boss = mesh(sphere(1, 0.03, A.r * 0.5, A.r * 0.48, 40), MAT.blue);
    boss.position.x = sx * 0.078;
    pod.add(boss);
    head.add(pod);
  }

  // ---- gem ----
  const gf = G.surfaceFrame(helmetZ, Gm.x, Gm.y, -0.004);
  const gem = named(new THREE.Group(), "nx-gem");
  gem.position.copy(gf.p);
  gem.quaternion.copy(gf.q);
  // faceted crystal body under a clear shell, a hot core, a two-arm swirl and a bright rim
  const facetGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = facetGeo.attributes.position;
    const cols = [];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const lo = new THREE.Color("#049cc8");
    const hi = new THREE.Color("#3fd8ec");
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      // brighter toward the centre of the disc, random per face
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const k = G.clamp(0.25 + 0.55 * rnd() + 0.35 * (1 - Math.hypot(cx, cy)), 0, 1);
      c.copy(lo).lerp(hi, k);
      for (let j = 0; j < 3; j++) cols.push(c.r, c.g, c.b);
    }
    facetGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  }
  const facet = mesh(facetGeo, MAT.gemFacet, { cast: false });
  facet.scale.set(Gm.r * 0.95, Gm.r * 0.89, 0.034);
  facet.position.z = 0.0;
  gem.add(facet);
  const shellM = mesh(sphere(1, Gm.r, Gm.r * 0.92, 0.062, 64), MAT.gemShell, { cast: false });
  shellM.position.z = 0.004;
  shellM.renderOrder = 4;
  gem.add(shellM);
  const core = mesh(sphere(1, Gm.r * 0.56, Gm.r * 0.52, 0.02, 40), MAT.gemCore, { cast: false });
  core.position.z = 0.034;
  gem.add(core);
  for (let arm = 0; arm < 2; arm++) {
    const spir = [];
    for (let i = 0; i <= 70; i++) {
      const t = i / 70;
      const ang = arm * Math.PI + t * Math.PI * 2.6;
      const r = Gm.r * (0.86 - t * 0.78);
      spir.push(V3(Math.cos(ang) * r, Math.sin(ang) * r * 0.92, 0.05 - 0.008 * t));
    }
    gem.add(mesh(G.tubeAlong(spir, 0.0085, { tubular: 120, radial: 8 }), MAT.gemSwirl, { cast: false }));
  }
  const rim = mesh(new THREE.TorusGeometry(Gm.r * 0.97, 0.0055, 12, 96), MAT.gemSwirl, { cast: false });
  rim.scale.y = 0.92;
  rim.position.z = 0.008;
  gem.add(rim);
  head.add(gem);

  // cyan spill on the forehead around the gem: an additive soft patch hugging the helmet surface
  const glowTex = radialTexture("rgba(255,255,255,0.9)", "rgba(255,255,255,0)", 256, 2.4);
  const glowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color("#36c9e0").multiplyScalar(0.9),
    map: glowTex,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  const GR = Gm.r * 2.6;
  const glowGeo = G.polarPatch({
    outlineFn: (t) => {
      // shrink the radius until the point is still well on the helmet (never poke through the crown)
      let r = GR;
      for (let i = 0; i < 160; i++) {
        const x = Gm.x + r * Math.cos(t);
        const y = Gm.y + r * 0.9 * Math.sin(t);
        if (helmetZ(x, y) > 0.06) break;
        r *= 0.985;
      }
      return [Gm.x + r * Math.cos(t), Gm.y + r * 0.9 * Math.sin(t)];
    },
    centre: [Gm.x, Gm.y],
    rings: 14,
    around: 64,
    zFn: (x, y) => helmetZ(x, y) + 0.002,
    uv: true,
  });
  const glow = named(mesh(glowGeo, glowMat, { cast: false, receive: false }), "nx-gem-glow");
  glow.renderOrder = 3;
  glow.userData.noAO = true; // it hovers above the plate; the AO pass would read its edge as a depth step
  head.add(glow);

  // ---- antenna ----
  const baseY = topY(P, AN.baseX);
  const ant = named(new THREE.Group(), "nx-antenna");
  ant.position.set(AN.baseX, baseY - 0.012, 0);
  const collarProfile = G.splineProfile(
    [
      [0, -0.02],
      [0.045, -0.018],
      [0.05, 0.004],
      [0.036, 0.024],
      [0.02, 0.034],
      [0, 0.036],
    ],
    30,
  );
  ant.add(mesh(G.latheSmooth(collarProfile, { segs: 48 }), MAT.blueDeep));
  const tip = [AN.tipX - AN.baseX, AN.tipY - 0.012, 0];
  const stemPts = [V3(0, 0.02, 0), V3(0.02, 0.1, 0), V3(0.062, 0.19, 0), V3(tip[0] * 0.98, tip[1] - AN.ball * 0.9, 0)];
  ant.add(mesh(G.tubeAlong(stemPts, AN.stem, { tubular: 48, radial: 14, tension: "catmullrom" }), MAT.blueDeep));
  const tipNode = named(new THREE.Group(), "nx-antenna-tip");
  tipNode.position.set(tip[0], tip[1], tip[2]);
  tipNode.add(mesh(sphere(AN.ball, 1, 1, 1, 64), MAT.antennaBall));
  ant.add(tipNode);
  head.add(ant);

  head.userData.surface = surf;
  return { helmet, plate, surf };
}

/** Helmet crown height above x (z = 0), from the superquadric. */
function topY(P, x) {
  // solve y where superFrontZ(x, y) -> 0 on the crown: bisection on y in [0, ry]
  let lo = 0;
  let hi = P.ry;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (G.superFrontZ(x, mid, P) > 1e-4) lo = mid;
    else hi = mid;
  }
  return lo;
}
