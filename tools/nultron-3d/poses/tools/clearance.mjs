// Clearance check: for every state (or the ones named), how deep do the hands and held props sink into the helmet, the
// faceplate, the torso and the collar? The body surfaces are dense vertex clouds with normals (spatial hash); a sample point
// on a hand/prop mesh is inside a part when it lies behind the nearest surface vertex's normal. Depth ~ the distance to that
// tangent plane. Anything deeper than the tolerance is reported.
//   node poses/tools/clearance.mjs [state ...] [--tol 0.012] [--all]
import * as THREE from "three";
import { buildNultron } from "../../character.js";
import { applyPose, STATE_NAMES, POSES } from "../../rig.js";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const TOL = Number(flag("--tol", 0.012));
const iAll = args.indexOf("--all");
const showAll = iAll >= 0;
if (showAll) args.splice(iAll, 1);
const states = args.length ? args : STATE_NAMES;

// Props meant to sit on or around the head or the floor, and floating fx, are not part of the hand/prop test.
const SKIP_PROPS = new Set(["listening", "charging", "sleep", "thinking", "surprised", "sparks", "celebrating", "lets-go", "wave", "tear", "heart-mini"]);
const SKIP_MESH = /glow|beam|halo|aura/i;
const CELL = 0.05;
const REACH = 2; // cells searched around a point (+-2 cells = 10 cm)

const root = buildNultron();

/** Meshes forming the body surfaces the hands must not enter (each part's own geometry plus its head-detail children). */
function bodyMeshes() {
  const out = [];
  const add = (o) => o?.isMesh && out.push(o);
  for (const n of ["nx-helmet", "nx-faceplate", "nx-ear-l", "nx-ear-r", "nx-gem"]) {
    const o = root.getObjectByName(n);
    if (!o) continue;
    add(o);
    o.traverse((c) => c !== o && add(c));
  }
  add(root.getObjectByName("nx-torso"));
  add(root.getObjectByName("nx-torso-chest"));
  add(root.getObjectByName("nx-neck"));
  return [...new Set(out)].filter((m) => !SKIP_MESH.test(m.name));
}

const parts = bodyMeshes().map((mesh) => {
  const g = mesh.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  return { mesh, pos: g.attributes.position, nor: g.attributes.normal, name: mesh.name };
});

function buildCloud() {
  const cells = new Map();
  const pts = [];
  const nrm = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const part of parts) {
    part.mesh.updateWorldMatrix(true, false);
    nm.getNormalMatrix(part.mesh.matrixWorld);
    const step = Math.max(1, Math.floor(part.pos.count / 40000));
    for (let i = 0; i < part.pos.count; i += step) {
      v.fromBufferAttribute(part.pos, i).applyMatrix4(part.mesh.matrixWorld);
      n.fromBufferAttribute(part.nor, i).applyMatrix3(nm).normalize();
      const idx = pts.length;
      pts.push(v.clone());
      nrm.push(n.clone());
      const key = `${Math.floor(v.x / CELL)},${Math.floor(v.y / CELL)},${Math.floor(v.z / CELL)}`;
      (cells.get(key) ?? cells.set(key, []).get(key)).push(idx);
    }
  }
  return { cells, pts, nrm };
}

/** Penetration depth of point p (0 when outside). */
function depthAt(cloud, p) {
  const cx = Math.floor(p.x / CELL);
  const cy = Math.floor(p.y / CELL);
  const cz = Math.floor(p.z / CELL);
  let best = Infinity;
  let bi = -1;
  for (let x = cx - REACH; x <= cx + REACH; x++)
    for (let y = cy - REACH; y <= cy + REACH; y++)
      for (let z = cz - REACH; z <= cz + REACH; z++) {
        const list = cloud.cells.get(`${x},${y},${z}`);
        if (!list) continue;
        for (const i of list) {
          const d = cloud.pts[i].distanceToSquared(p);
          if (d < best) {
            best = d;
            bi = i;
          }
        }
      }
  if (bi < 0) return 0;
  const s = p.clone().sub(cloud.pts[bi]).dot(cloud.nrm[bi]);
  return s < 0 ? Math.min(-s, Math.sqrt(best)) : 0;
}

function meshesUnder(obj, filter = () => true) {
  const out = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    if (SKIP_MESH.test(o.name) || (o.material?.transparent === true && (o.material.opacity ?? 1) < 0.5)) return;
    if (filter(o)) out.push(o);
  });
  return out;
}

function samplePoints(meshes, cap = 1200) {
  const pts = [];
  const v = new THREE.Vector3();
  const total = meshes.reduce((a, m) => a + m.geometry.attributes.position.count, 0);
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(total / cap));
    for (let i = 0; i < pos.count; i += step) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).clone());
  }
  return pts;
}

const inProp = (m) => {
  for (let p = m; p; p = p.parent) if (p.name.startsWith("nx-prop")) return true;
  return false;
};

const rows = [];
for (const state of states) {
  applyPose(root, state);
  root.updateMatrixWorld(true);
  const cloud = buildCloud();
  const def = POSES.states[state];
  const handMeshes = ["l", "r"].flatMap((s) => meshesUnder(root.getObjectByName(`nx-hand-${s}`), (m) => !inProp(m)));
  const propMeshes = [].concat(def.prop ?? []).flatMap((spec) => {
    if (SKIP_PROPS.has(spec.name)) return [];
    const o = root.getObjectByName(`nx-prop-${spec.name}`);
    return o ? meshesUnder(o) : [];
  });
  const test = (pts) => {
    let worst = { depth: 0, at: null };
    let count = 0;
    for (const p of pts) {
      const d = depthAt(cloud, p);
      if (d > TOL) count++;
      if (d > worst.depth) worst = { depth: d, at: p.toArray().map((x) => +x.toFixed(2)) };
    }
    return { count, worst, total: pts.length };
  };
  rows.push({ state, hand: test(samplePoints(handMeshes)), prop: test(samplePoints(propMeshes)) });
}

for (const r of rows) {
  const flagged = r.hand.worst.depth > TOL || r.prop.worst.depth > TOL;
  if (!flagged && !showAll) continue;
  const fmt = (x) => (x.worst.depth > 0 ? `${(x.worst.depth * 100).toFixed(1)} cm at ${JSON.stringify(x.worst.at)} (${x.count}/${x.total} pts)` : "clear");
  console.log(`${r.state.padEnd(12)} hands: ${fmt(r.hand)}  |  props: ${fmt(r.prop)}`);
}
console.log(`checked ${rows.length} states, tolerance ${(TOL * 100).toFixed(1)} cm; ${rows.filter((r) => r.hand.worst.depth > TOL || r.prop.worst.depth > TOL).length} flagged`);
