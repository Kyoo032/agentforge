// Renderer side of the poser's preview: draws a grid of posed characters into one WebGL canvas.
import * as THREE from "three";

const q = new URLSearchParams(location.search);
const opt = {
  model: q.get("model") ?? "proxy",
  view: q.get("view") ?? "front",
  states: q.get("states") ?? "",
  cols: Number(q.get("cols") ?? 7),
  tw: Number(q.get("tw") ?? 360),
  th: Number(q.get("th") ?? 420),
  strip: Number(q.get("strip") ?? 0),
  t0: Number(q.get("t0") ?? 0),
  t1: Number(q.get("t1") ?? 1),
  mode: q.get("mode") ?? "",
  label: q.get("label") !== "0",
  fit: q.get("fit") ?? "full",
  bg: q.get("bg") ?? "#eef1f6",
};

window.__log = "";

async function main() {
  const rig = await import("../rig.js");
  const build = opt.model === "real" ? await import("../character.js") : await import("./proxy.js");
  const root = build.buildNultron();
  const scene = new THREE.Scene();
  scene.add(root);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8e2f4, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(-1.4, 2.6, 2.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfeaff, 0.9);
  fill.position.set(2.2, 1.2, 1.6);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8);
  rim.position.set(0.5, 1.5, -2);
  scene.add(rim);

  // Ground blob shadow.
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(40,50,80,0.35)");
  grad.addColorStop(1, "rgba(40,50,80,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 1.3),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  scene.add(shadow);

  // Tiles: one per state, or one state at N times.
  let tiles;
  if (opt.strip > 0) {
    const st = opt.states.split(",")[0];
    tiles = Array.from({ length: opt.strip }, (_, i) => {
      const t = opt.strip === 1 ? opt.t0 : opt.t0 + ((opt.t1 - opt.t0) * i) / (opt.strip - 1);
      return { state: st, t, label: `${st}  t=${t.toFixed(2)}s  f${Math.round(t * 12)}` };
    });
  } else {
    const names = opt.states ? opt.states.split(",") : rig.STATE_NAMES;
    tiles = names.map((s) => ({ state: s, t: undefined, label: s }));
  }
  const cols = Math.min(opt.cols, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * opt.tw;
  const H = rows * opt.th;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  renderer.setClearColor(new THREE.Color(opt.bg), 1);
  document.getElementById("wrap").appendChild(renderer.domElement);

  const aspect = opt.tw / opt.th;
  const camera = new THREE.PerspectiveCamera(26, aspect, 0.1, 50);
  const azim = opt.view === "34" ? 34 : opt.view === "side" ? 90 : 0;
  const elev = opt.view === "34" ? 6 : 0;
  const head = opt.fit === "head";
  const target = new THREE.Vector3(0, head ? 1.55 : 1.12, 0);
  const dist = head ? 3.3 : 5.9;
  const a = (azim * Math.PI) / 180;
  const e = (elev * Math.PI) / 180;
  camera.position.set(target.x + dist * Math.sin(a) * Math.cos(e), target.y + dist * Math.sin(e), target.z + dist * Math.cos(a) * Math.cos(e));
  camera.lookAt(target);

  renderer.clear();
  const wrap = document.getElementById("wrap");
  wrap.style.width = `${W}px`;
  wrap.style.height = `${H}px`;

  tiles.forEach((tile, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * opt.tw;
    const yTop = row * opt.th;
    rig.applyPose(root, tile.state, tile.t === undefined ? {} : { t: tile.t, mode: opt.mode || undefined });
    // Fx placeholders are sprites (billboards); nothing else to face the camera.
    renderer.setViewport(x, H - yTop - opt.th, opt.tw, opt.th);
    renderer.setScissor(x, H - yTop - opt.th, opt.tw, opt.th);
    renderer.render(scene, camera);
    if (opt.label) {
      const d = document.createElement("div");
      d.className = "lab";
      d.style.left = `${x}px`;
      d.style.width = `${opt.tw}px`;
      d.style.top = `${yTop + opt.th - 30}px`;
      d.innerHTML = `${tile.label}`;
      wrap.appendChild(d);
    }
  });
  window.__size = { w: W, h: H };
  window.__ready = true;
}

main().catch((err) => {
  window.__error = String(err?.stack ?? err);
  console.error(window.__error);
});
