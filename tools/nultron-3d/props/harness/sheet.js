// Props contact sheet: every prop alone in a 3/4 view, labelled, on a light and a dark background.
//   sheet.html?group=held|worn|floating|extras|all &names=a,b &bg=light|dark|both &cols=6 &cell=300 &cellh=270
//             &mitt=0 &az=32 &el=14 &fov=28
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PROPS, PROP_GROUPS } from "../../props.js";
import { DIMS } from "../dims.js";
import { MAT } from "../mats.js";

const q = new URLSearchParams(location.search);
const group = q.get("group") ?? "all";
const names = q.get("names")
  ? q.get("names").split(",")
  : group === "all"
    ? [...PROP_GROUPS.held, ...PROP_GROUPS.worn, ...PROP_GROUPS.floating, ...PROP_GROUPS.extras]
    : PROP_GROUPS[group];
const bgMode = q.get("bg") ?? "both";
const cols = Number(q.get("cols") ?? 6);
const cellW = Number(q.get("cell") ?? 300);
const cellH = Number(q.get("cellh") ?? Math.round(cellW * 0.9));
const showMitt = q.get("mitt") !== "0";
const showLabels = q.get("labels") !== "0";
const az = THREE.MathUtils.degToRad(Number(q.get("az") ?? 32));
const el = THREE.MathUtils.degToRad(Number(q.get("el") ?? 14));
const fov = Number(q.get("fov") ?? 28);
const BG = { light: "#eee6dc", dark: "#1a2233" };

const backgrounds = bgMode === "both" ? ["light", "dark"] : [bgMode];
const rows = Math.ceil(names.length / cols);
const BANNER = showLabels ? 26 : 0;
const W = cols * cellW;
const H = rows * cellH * backgrounds.length + backgrounds.length * BANNER;

async function main() {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(W, H, false);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-2, 3.2, 3);
  const fill = new THREE.HemisphereLight(0xdff2ff, 0xf1e4d6, 0.55);
  scene.add(key, fill);

  const cam = new THREE.PerspectiveCamera(fov, cellW / cellH, 0.05, 50);

  const built = names.map((n) => {
    try {
      return { name: n, obj: PROPS[n]() };
    } catch (e) {
      console.error(`build ${n} failed: ${e.stack}`);
      return { name: n, obj: null, error: String(e) };
    }
  });

  // Ghost stand-ins so fit can be judged before the real character is in the frame.
  const ghostMat = new THREE.MeshStandardMaterial({ color: "#7aa9d6", transparent: true, opacity: 0.35, roughness: 0.6 });
  const standIn = (name) => {
    const g = new THREE.Group();
    if (name === "listening") {
      const { l, r } = DIMS.earPod;
      const { x, y, z } = DIMS.helmet.radii;
      const head = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), MAT.blue);
      head.scale.set(x, y, z);
      g.add(head);
      for (const p of [l, r]) {
        const pod = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, p.depth, 32), MAT.blueDeep);
        pod.rotation.z = Math.PI / 2;
        pod.position.set(...p.center);
        g.add(pod);
      }
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.27, 12), MAT.blueDeep);
      const [ax, ay, az] = DIMS.antennaBaseLocal;
      ant.position.set(ax + 0.057, ay + 0.12, az);
      ant.rotation.z = -0.44;
      g.add(ant);
    }
    if (name === "charging") {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 8, 24), ghostMat);
      body.position.y = 0.72;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.52, 32, 24), ghostMat);
      head.position.y = 1.55;
      g.add(body, head);
    }
    return g;
  };

  const boundsOf = (root) => {
    const box = new THREE.Box3();
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh || o.name === "glow" || o.name === "beam") return;
      o.geometry.computeBoundingBox();
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    });
    return box;
  };

  const paintLabel = (x, y, html, cls) => {
    if (!showLabels) return;
    const d = document.createElement("div");
    d.className = `lab ${cls}`;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.innerHTML = html;
    document.body.append(d);
  };

  let yOff = 0;
  for (const bgName of backgrounds) {
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.hidden = !showLabels;
    banner.style.left = "10px";
    banner.style.top = `${yOff + 6}px`;
    banner.style.color = bgName === "light" ? "#34495e" : "#cfe6f5";
    banner.textContent = `${bgName} background`;
    document.body.append(banner);
    const blockH = rows * cellH + BANNER;
    renderer.setScissorTest(true);
    renderer.setViewport(0, H - (yOff + blockH), W, blockH);
    renderer.setScissor(0, H - (yOff + blockH), W, blockH);
    renderer.setClearColor(BG[bgName], 1);
    renderer.clear();
    yOff += BANNER;

    built.forEach(({ name, obj }, i) => {
      const cx = (i % cols) * cellW;
      const cyTop = yOff + Math.floor(i / cols) * cellH;
      const vy = H - (cyTop + cellH);
      renderer.setViewport(cx, vy, cellW, cellH);
      renderer.setScissor(cx, vy, cellW, cellH);
      renderer.setClearColor(BG[bgName], 1);
      renderer.clear();
      if (!obj) {
        paintLabel(cx + 8, cyTop + 6, `<b>${name}</b><br>BUILD FAILED`, bgName);
        return;
      }
      const extra = standIn(name);
      scene.add(obj, extra);
      const marks = [];
      if (showMitt && obj.userData.kind === "held") {
        for (const gName of ["grip", "grip-l", "grip-r"]) {
          const gp = obj.getObjectByName(gName);
          if (!gp) continue;
          const s = new THREE.Mesh(
            new THREE.SphereGeometry(DIMS.mittRadius, 24, 16),
            new THREE.MeshBasicMaterial({ color: gName === "grip" ? "#e8544e" : "#f0a030", transparent: true, opacity: 0.32, depthWrite: false }),
          );
          gp.add(s);
          marks.push([gp, s]);
        }
      }
      const box = boundsOf(obj);
      if (name === "listening" || name === "charging") box.union(boundsOf(extra));
      const center = box.getCenter(new THREE.Vector3());
      const sphereR = box.getSize(new THREE.Vector3()).length() / 2;
      const dist = (sphereR / Math.sin(THREE.MathUtils.degToRad(fov) / 2)) * Number(q.get("margin") ?? 1.14);
      cam.position.set(
        center.x + dist * Math.cos(el) * Math.sin(az),
        center.y + dist * Math.sin(el),
        center.z + dist * Math.cos(el) * Math.cos(az),
      );
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const u = obj.userData;
      const size = boundsOf(obj).getSize(new THREE.Vector3());
      paintLabel(
        cx + 8,
        cyTop + 6,
        `<b>${name}</b><br>${u.kind}${u.hands ? ` / hand ${u.hands}` : ""} / ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`,
        bgName,
      );
      for (const [gp, s] of marks) gp.remove(s);
      scene.remove(obj, extra);
    });
    yOff += rows * cellH;
  }
  window.__ready = true;
}

main().catch((e) => {
  console.error(e.stack ?? e);
  window.__error = String(e.stack ?? e);
});
