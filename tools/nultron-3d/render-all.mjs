#!/usr/bin/env node
// Renders the shipping image set: node render-all.mjs --out <dir> [--quality 90] [--loop-size 320] [--only full,head,clips,loops,brand]
// (--out defaults to tools/nultron-3d/out, which is git-ignored; nothing here writes into the app: sync-images.mjs does that)
//
//   out/full/<state>.webp    512, full body, front, one fixed camera for every state (same scale and ground line)
//   out/head/<state>.webp    256, head + antenna close-up, tracks the head, eyes a touch bigger
//   out/clips/<state>.webp   one-shot strips (320 per frame, 12 fps, <= 14 frames), last frame == the still
//   out/loops/<state>.webp   4-frame busy loops (only the states the app loops while a job runs)
//   out/brand/*.png          icon tile, head, full body at 1024 for the brand designer
//   out/manifest.json        what the app reads;  out/contact.png  review sheet (built by make-contact.mjs)
//
// Same trick as render.mjs: under node it launches the repo's Electron on this file, under Electron it renders.
// The scene is built once per size (scene.html?multi=1) and re-posed per frame, so the whole set takes a couple of minutes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as THREE from "three";
import { applyGpuSwitches, launchElectron } from "./lib/electron.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// States that loop while a job runs (the app forbids decorative infinite animation, so idle and sleep never loop).
const LOOP_STATES = [
  "thinking", "writing", "answering", "searching", "calculating", "charting", "reviewing",
  "listening", "painting", "filming", "editing", "presenting", "charging",
];
const MAX_CLIP_FRAMES = 14; // 14 / 12 fps = 1.17 s, under the 1.2 s cap
const HEAD = { dy: 0.16, dist: 4.65, eyeBoost: 1.08 }; // head close-up framing

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    o[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
  }
  return o;
}

// ---------------------------------------------------------------------------------------------------------------------
// camera fit (plain three.js maths, runs in the Electron main process)
// ---------------------------------------------------------------------------------------------------------------------
function fitCamera(boxes, { fov = 20, elev = 0.026, margin = 0.035, extraTop = 0 } = {}) {
  const pts = [];
  for (const b of boxes) {
    const max = [b.max[0], b.max[1] + (extraTop && b.max[1] > 1.5 ? extraTop : 0), b.max[2]];
    for (const x of [b.min[0], max[0]]) for (const y of [b.min[1], max[1]]) for (const z of [b.min[2], max[2]]) pts.push(new THREE.Vector3(x, y, z));
  }
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  const tanH = Math.tan((fov * Math.PI) / 360);
  const centre = () => {
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      lo.min(p);
      hi.max(p);
    }
    return lo.add(hi).multiplyScalar(0.5);
  };
  const place = (target, D) => {
    cam.position.set(target.x, target.y + D * elev, target.z + D);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
  };
  const extents = () => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) {
      const n = p.clone().project(cam);
      x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
    }
    return { x0, x1, y0, y1 };
  };
  const target = centre();
  target.z = 0;
  let lo = 3;
  let hi = 30;
  let best = null;
  for (let it = 0; it < 40; it++) {
    const D = (lo + hi) / 2;
    const t = target.clone();
    let e;
    for (let k = 0; k < 6; k++) {
      place(t, D);
      e = extents();
      t.x += ((e.x0 + e.x1) / 2) * tanH * D;
      t.y += ((e.y0 + e.y1) / 2) * tanH * D;
    }
    place(t, D);
    e = extents();
    const half = Math.max(e.x1 - e.x0, e.y1 - e.y0) / 2;
    if (half <= 1 - margin) {
      best = { D, t: t.clone() };
      hi = D;
    } else lo = D;
  }
  const { D, t } = best;
  return { fov, target: t.toArray().map((v) => +v.toFixed(4)), position: [t.x, t.y + D * elev, t.z + D].map((v) => +v.toFixed(4)), distance: +D.toFixed(3) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Electron side
// ---------------------------------------------------------------------------------------------------------------------
async function run(electron, opts) {
  const { app, BrowserWindow } = electron;
  applyGpuSwitches(app);
  await app.whenReady();

  const outDir = resolve(opts.out ?? join(here, "out"));
  const quality = Number(opts.quality ?? 90) / 100;
  const loopSize = Number(opts["loop-size"] ?? 320);
  const only = new Set((opts.only ?? "full,head,clips,loops,brand").split(","));
  const POSES = JSON.parse(readFileSync(join(here, "poses.json"), "utf8"));
  const states = Object.keys(POSES.states);
  const log = (...a) => console.log("[render-all]", ...a);

  const win = new BrowserWindow({
    width: 512, height: 512, show: false, frame: false, transparent: true, backgroundColor: "#00000000",
    webPreferences: { webSecurity: false, contextIsolation: true, sandbox: false, nodeIntegration: false, backgroundThrottling: false },
  });
  win.webContents.on("console-message", (e, ...rest) => {
    const msg = typeof e === "object" && e && "message" in e ? e.message : rest[1];
    if (/ERROR|failed|Error/.test(String(msg)) && !/Security Warning/.test(String(msg))) console.log("  page:", msg);
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const session = async (params) => {
    await win.loadURL("about:blank");
    const query = { multi: "1", ...params };
    await win.loadFile(join(here, "scene.html"), { query: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) });
    const r = await js(
      "new Promise((res)=>{const t=Date.now();const f=()=>{ if(window.__error) return res({error:window.__error}); if(window.__ready) return res({ok:true}); if(Date.now()-t>120000) return res({error:'timeout'}); setTimeout(f,50)};f()})",
    );
    if (r.error) throw new Error(`scene error: ${r.error}`);
  };
  const writeImg = async (rel, mime, q) => {
    const url = await js(`window.__export(${JSON.stringify(mime)}, ${q})`);
    if (!url.startsWith(`data:${mime}`)) throw new Error(`export gave ${url.slice(0, 30)} instead of ${mime}`);
    const buf = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
    const p = join(outDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, buf);
    return buf.length;
  };

  const manifest = { version: 1, full: { size: 512, states: {} }, head: { size: 256, states: {} }, clips: {}, loops: {}, bytes: 0 };
  const stats = {};
  const tStart = Date.now();

  // 1. measure every pose we will render (stills, clip frames, loop frames) to fix ONE camera for the full-body set
  await session({ view: "full", size: 64, ss: 1 });
  const clipPlan = {};
  const loopPlan = {};
  for (const st of states) {
    const def = POSES.states[st];
    if (def.clip) {
      const fps = def.clip.fps ?? 12;
      const last = def.clip.frames[def.clip.frames.length - 1].f;
      const T = last / fps;
      const n = Math.min(last + 1, MAX_CLIP_FRAMES);
      const times = Array.from({ length: n }, (_, i) => (n === last + 1 ? i / fps : (i * T) / (n - 1)));
      times[n - 1] = T; // the last frame is exactly the still
      clipPlan[st] = { n, times, seconds: +(n / fps).toFixed(3) };
    }
    if (def.loop && LOOP_STATES.includes(st)) {
      const fps = def.loop.fps ?? 4;
      loopPlan[st] = { n: 4, fps, times: Array.from({ length: 4 }, (_, i) => i / fps) };
    }
  }
  const boxes = [];
  const perState = {};
  const labelled = [];
  const note = (label, b) => {
    boxes.push(b);
    labelled.push({ label, ...b });
  };
  for (const st of states) {
    perState[st] = await js(`window.__measure(${JSON.stringify({ state: st })})`);
    note(`${st} still`, perState[st]);
    for (const [i, t] of (clipPlan[st]?.times ?? []).entries()) note(`${st} clip ${i}`, await js(`window.__measure(${JSON.stringify({ state: st, t, mode: "clip" })})`));
    for (const [i, t] of (loopPlan[st]?.times ?? []).entries()) note(`${st} loop ${i}`, await js(`window.__measure(${JSON.stringify({ state: st, t, mode: "loop" })})`));
  }
  const logDir = join(here, "work", "render-all"); // diagnostics stay out of out/ (it is budgeted)
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "measure.json"), JSON.stringify(labelled));
  boxes.push({ min: [-0.5, 0, -0.4], max: [0.9, 0.02, 0.5] }); // ground shadow blobs
  const fullCam = fitCamera(boxes, { margin: 0.03 });
  const idleBoxes = [perState.idle, { min: [-0.5, 0, -0.4], max: [0.9, 0.02, 0.5] }];
  const brandCam = fitCamera(idleBoxes, { margin: 0.07, extraTop: 0.1 });
  log("measured", boxes.length, "poses; full camera", JSON.stringify(fullCam));
  const union = boxes.reduce((u, b) => ({ min: u.min.map((v, i) => Math.min(v, b.min[i])), max: u.max.map((v, i) => Math.max(v, b.max[i])) }));
  log("union bounds", JSON.stringify(union));

  // 2. full body stills
  if (only.has("full")) {
    await session({ view: "full", size: 512, ss: 3 });
    let bytes = 0;
    for (const st of states) {
      await js("window.__begin(1)");
      await js(`window.__frame(${JSON.stringify({ state: st, cam: fullCam })}, 0)`);
      bytes += await writeImg(`full/${st}.webp`, "image/webp", quality);
      manifest.full.states[st] = `full/${st}.webp`;
    }
    stats.full = bytes;
    log("full", states.length, bytes, "bytes", `${((Date.now() - tStart) / 1000).toFixed(0)}s`);
  }

  // 3. head close-ups
  if (only.has("head")) {
    await session({ view: "head", size: 256, ss: 4 });
    let bytes = 0;
    for (const st of states) {
      await js("window.__begin(1)");
      await js(`window.__frame(${JSON.stringify({ state: st, headOnly: true, eyeBoost: HEAD.eyeBoost, trackHead: { dy: HEAD.dy, dist: HEAD.dist } })}, 0)`);
      bytes += await writeImg(`head/${st}.webp`, "image/webp", quality);
      manifest.head.states[st] = `head/${st}.webp`;
    }
    stats.head = bytes;
    log("head", states.length, bytes, "bytes");
  }

  // 4. one-shot clips
  if (only.has("clips")) {
    await session({ view: "full", size: 320, ss: 4 });
    let bytes = 0;
    for (const [st, plan] of Object.entries(clipPlan)) {
      await js(`window.__begin(${plan.n})`);
      for (let i = 0; i < plan.n; i++) await js(`window.__frame(${JSON.stringify({ state: st, t: plan.times[i], mode: "clip", cam: fullCam })}, ${i})`);
      const b = await writeImg(`clips/${st}.webp`, "image/webp", quality);
      bytes += b;
      manifest.clips[st] = { src: `clips/${st}.webp`, frames: plan.n, fps: 12, size: 320 };
      log("clip", st, plan.n, "frames", plan.seconds, "s", b, "bytes");
    }
    stats.clips = bytes;
  }

  // 5. busy loops (256 px per frame when asked to trim the budget)
  if (only.has("loops")) {
    await session({ view: "full", size: loopSize, ss: loopSize > 300 ? 4 : 4 });
    let bytes = 0;
    for (const [st, plan] of Object.entries(loopPlan)) {
      await js(`window.__begin(${plan.n})`);
      for (let i = 0; i < plan.n; i++) await js(`window.__frame(${JSON.stringify({ state: st, t: plan.times[i], mode: "loop", cam: fullCam })}, ${i})`);
      const b = await writeImg(`loops/${st}.webp`, "image/webp", quality);
      bytes += b;
      manifest.loops[st] = { src: `loops/${st}.webp`, frames: plan.n, fps: plan.fps, size: loopSize };
    }
    stats.loops = bytes;
    log("loops", Object.keys(loopPlan).length, bytes, "bytes");
  }

  // 6. brand set (PNG, transparent, 1024)
  if (only.has("brand")) {
    let bytes = 0;
    await session({ view: "full", size: 1024, ss: 3 });
    await js("window.__begin(1)");
    await js(`window.__frame(${JSON.stringify({ state: "idle", cam: brandCam })}, 0)`);
    bytes += await writeImg("brand/full-1024.png", "image/png", 1);
    await session({ view: "head", size: 1024, ss: 3 });
    await js("window.__begin(1)");
    await js(`window.__frame(${JSON.stringify({ state: "idle", trackHead: { dy: 0.1, dist: 5.2 } })}, 0)`);
    bytes += await writeImg("brand/head-1024.png", "image/png", 1);
    // the approved icon view goes through the single-shot path
    await win.loadURL("about:blank");
    await win.loadFile(join(here, "scene.html"), { query: { view: "icon", size: "1024", ss: "3", bg: "transparent" } });
    await js("new Promise((res)=>{const f=()=>{ if(window.__error||window.__ready) return res(1); setTimeout(f,50)};f()})");
    const r = await js("window.__render()");
    const buf = Buffer.from(r.dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
    mkdirSync(join(outDir, "brand"), { recursive: true });
    writeFileSync(join(outDir, "brand", "icon-tile-1024.png"), buf);
    bytes += buf.length;
    stats.brand = bytes;
    log("brand", bytes, "bytes");
  }

  // manifest: `bytes` = the shipped assets (full + head + clips + loops), everything the app downloads
  manifest.bytes = (stats.full ?? 0) + (stats.head ?? 0) + (stats.clips ?? 0) + (stats.loops ?? 0);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(logDir, "render-stats.json"), `${JSON.stringify({ stats, fullCam, brandCam, union, seconds: (Date.now() - tStart) / 1000 }, null, 2)}\n`);
  log("done in", ((Date.now() - tStart) / 1000).toFixed(0), "s; shipped bytes", manifest.bytes, JSON.stringify(stats));
  win.destroy();
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.versions.electron) process.exit(await launchElectron(fileURLToPath(import.meta.url), process.argv.slice(2)));
  const electron = (await import("electron")).default;
  try {
    electron.app.exit(await run(electron, args));
  } catch (err) {
    console.error(`render-all: ${err.stack ?? err}`);
    electron.app.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((err) => {
    console.error(`render-all: ${err.stack ?? err}`);
    process.exit(1);
  });
}
