// Offline render scene for Nultron (owner: modeller). Driven by render.mjs through the query string:
//   ?state=idle&view=full|head|icon&size=1024&bg=transparent|%23rrggbb&yaw=0&ss=3&exposure=1 ...
// window.__render() resolves { dataUrl, ms, info } once the frame is finished.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SavePass } from "three/addons/postprocessing/SavePass.js";
import { buildNultron, setEyes, setMouth, setHand, MAT } from "./character.js";
import { CAMERAS } from "./layout.js";
import { FinishPass } from "./finish-pass.js";
import { studioEnvironment, groundAndShadow, addLights } from "./stage.js";

/**
 * three's GTAOPass builds its denoise noise texture with SimplexNoise, which draws from Math.random(). Left alone, every
 * render puts a different noise pattern in the ambient occlusion (about 0.9 of 255 on average, a few pixels far more), so two
 * runs of the same scene are never byte-identical. The pass is built with this seeded generator instead (mulberry32).
 */
const AO_NOISE_SEED = 0x4e554c54; // "NULT"
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const P = {
  state: q.get("state") || "idle",
  view: q.get("view") || "full",
  size: num("size", 1024),
  ss: num("ss", 3),
  bg: q.get("bg") || "transparent",
  yaw: num("yaw", 0),
  pitch: num("pitch", 0),
  exposure: num("exposure", 0.8),
  envI: num("env", 1),
  keyI: num("key", 0.8),
  ao: num("ao", 0.75),
  bloom: num("bloom", 1),
  sat: num("sat", 1),
  shadow: num("shadow", 1),
  tone: q.get("tone") || "neutral",
  envbase: num("envbase", 0.55),
  boxk: num("boxk", 0.8),
  front: num("front", 1.4),
  zoom: num("zoom", 1),
  eyes: q.get("eyes"),
  mouth: q.get("mouth"),
};

async function tryImport(path) {
  try {
    return await import(path);
  } catch (e) {
    console.log(`[scene] ${path} not loaded (${String(e.message || e).slice(0, 80)})`);
    return null;
  }
}

/** The reference's standing pose: arms out and back in (bean-shaped sleeves), hands beside the belly. Used by --pose ref. */
function refIdle(root) {
  const set = (n, x, y, z) => {
    const o = root.getObjectByName(n);
    if (o) o.rotation.set(x, y, z);
  };
  set("nx-shoulder-l", 0, 0, -0.3);
  set("nx-shoulder-r", 0, 0, 0.3);
  set("nx-elbow-l", 0, 0, 0.16);
  set("nx-elbow-r", 0, 0, -0.16);
  set("nx-hand-l", 0, 0, 0.0);
  set("nx-hand-r", 0, 0, 0.0);
}

function fallbackIdle(root) {
  const set = (n, x, y, z) => {
    const o = root.getObjectByName(n);
    if (o) o.rotation.set(x, y, z);
  };
  set("nx-shoulder-l", 0, 0, -0.26);
  set("nx-shoulder-r", 0, 0, 0.26);
  set("nx-elbow-l", 0, 0, 0.05);
  set("nx-elbow-r", 0, 0, -0.05);
}

async function main() {
  const t0 = performance.now();
  const out = P.size;
  const big = Math.round(out * P.ss);
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(out, out, false);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const tones = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping };
  renderer.toneMapping = tones[P.tone] ?? THREE.AgXToneMapping;
  renderer.toneMappingExposure = P.exposure;
  const gl = renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const info = {
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "unknown",
    maxTex: renderer.capabilities.maxTextureSize,
    big,
  };

  if (q.has("cc")) MAT.blue.clearcoat = num("cc", MAT.blue.clearcoat);
  if (q.has("rough")) MAT.blue.roughness = num("rough", MAT.blue.roughness);
  if (q.has("ccr")) MAT.blue.clearcoatRoughness = num("ccr", MAT.blue.clearcoatRoughness);
  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer, { baseK: P.envbase, keyI: 5.2 * P.boxk, fillI: 1.5 * P.boxk, topI: 1.1 * P.boxk, rimI: 4.2 * P.boxk });
  scene.environmentIntensity = P.envI;

  const root = buildNultron({ tile: P.view === "icon" });
  scene.add(root);

  // pose: the poser's rig when it exists, otherwise a plain idle
  const rig = await tryImport("./rig.js");
  const props = await tryImport("./props.js");
  if (q.get("pose") === "ref") refIdle(root);
  else if (rig?.applyPose) {
    try {
      rig.applyPose(root, P.state, { props: props?.PROPS, t: q.has("t") ? Number(q.get("t")) : undefined, mode: q.get("mode") || undefined });
    } catch (e) {
      console.log("[scene] applyPose failed:", e.message);
      fallbackIdle(root);
    }
  } else fallbackIdle(root);
  if (P.eyes) setEyes(root, P.eyes);
  if (P.mouth) setMouth(root, P.mouth);
  for (const s of ["l", "r"]) {
    const h = q.get(`hand${s}`);
    if (h) setHand(root, s, h);
  }
  root.rotation.y = (P.yaw * Math.PI) / 180;

  const cam = CAMERAS[P.view] ?? CAMERAS.full;
  const camera = new THREE.PerspectiveCamera(cam.fov / P.zoom, 1, 0.1, 60);
  const target = new THREE.Vector3(...cam.target);
  const pos = new THREE.Vector3(...cam.position);
  if (q.has("tx") || q.has("ty")) {
    // re-aim the camera (same direction and distance) for close-up crops
    const nt = new THREE.Vector3(num("tx", target.x), num("ty", target.y), target.z);
    pos.add(nt.clone().sub(target));
    target.copy(nt);
  }
  if (P.pitch) {
    const d = pos.clone().sub(target);
    d.applyAxisAngle(new THREE.Vector3(1, 0, 0), (-P.pitch * Math.PI) / 180);
    pos.copy(target).add(d);
  }
  camera.position.copy(pos);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);

  if (P.view === "icon") {
    // head only, centred on the origin, no ears, no neck column
    root.position.y = -1.5;
    const body = root.getObjectByName("nx-body");
    for (const c of body.children) if (c.name !== "nx-neck") c.visible = false;
    root.getObjectByName("nx-neck").material = new THREE.MeshBasicMaterial({ visible: false });
    for (const e of ["nx-ear-l", "nx-ear-r"]) root.getObjectByName(e).visible = false;
  }

  const groundY = P.view === "icon" ? -0.7 : 0;
  groundAndShadow(scene, { y: groundY, icon: P.view === "icon", shadow: P.shadow });
  addLights(scene, { key: P.keyI, view: P.view, front: P.front, shadowMap: q.get("smap") !== "0" });

  // composer: HDR MSAA target -> AO -> bloom -> finish (tone map + downsample to the canvas)
  const rt = new THREE.WebGLRenderTarget(big, big, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(1);
  composer.setSize(big, big);
  composer.addPass(new RenderPass(scene, camera));
  if (P.ao > 0) {
    const realRandom = Math.random;
    Math.random = seededRandom(AO_NOISE_SEED); // only while the pass builds its noise texture
    const gtao = new GTAOPass(scene, camera, big, big);
    Math.random = realRandom;
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = P.ao;
    gtao.updateGtaoMaterial({ radius: 0.16, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 16 });
    const orig = gtao._overrideVisibility.bind(gtao);
    gtao._overrideVisibility = function () {
      orig();
      scene.traverse((o) => {
        if ((o.isSprite || o.userData.noAO) && o.visible) {
          o.visible = false;
          this._visibilityCache.push(o);
        }
      });
    };
    composer.addPass(gtao);
  }
  const coverageRT = new THREE.WebGLRenderTarget(big, big, { type: THREE.HalfFloatType });
  composer.addPass(new SavePass(coverageRT));
  if (P.bloom > 0) composer.addPass(new UnrealBloomPass(new THREE.Vector2(big, big), 0.22 * P.bloom, 0.8, 2.0));
  const finish = new FinishPass({
    coverage: coverageRT,
    ss: P.ss,
    bigSize: [big, big],
    toneMapping: renderer.toneMapping,
    exposure: P.exposure,
    saturation: P.sat,
    bg: P.bg === "transparent" ? null : P.bg,
  });
  composer.addPass(finish);

  // ---- multi-frame API (render-all.mjs): build once, re-pose and re-render many frames, compose strips, export webp/png ----
  if (q.get("multi") === "1") {
    const V3 = THREE.Vector3;
    let strip = null;
    let stripCtx = null;
    const hidden = [];
    const scaled = [];
    const inHead = (o) => {
      for (let a = o; a; a = a.parent) if (a.name === "nx-head") return true;
      return false;
    };
    const visibleBox = () => {
      const b = new THREE.Box3();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || o.material?.visible === false) return;
        for (let a = o; a; a = a.parent) if (!a.visible) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      return b;
    };
    const pose = (job) => {
      rig.applyPose(root, job.state, { props: props?.PROPS, t: job.t, mode: job.mode });
      root.rotation.y = ((job.yaw || 0) * Math.PI) / 180;
      if (job.headOnly) {
        // head close-ups show the expression: keep only props worn on the head, drop hand props, fx and the forearms/hands
        for (const n of ["nx-forearm-l", "nx-forearm-r"]) {
          const o = root.getObjectByName(n);
          if (o?.visible) {
            o.visible = false;
            hidden.push(o);
          }
        }
        root.traverse((o) => {
          if (o.name.startsWith("nx-prop-") && !inHead(o) && o.visible) {
            o.visible = false;
            hidden.push(o);
          }
        });
      }
      if (job.eyeBoost) {
        const eyes = root.getObjectByName("nx-eyes");
        for (const grp of eyes.children) {
          if (!grp.visible || !/open|surprised|wink/.test(grp.name)) continue;
          // open/surprised: both eye balls; wink: only the open eye (children[0]); the arc is built around the head origin
          const list = /wink/.test(grp.name) ? [grp.children[0]] : grp.children;
          for (const eye of list) {
            eye.scale.multiplyScalar(job.eyeBoost);
            scaled.push([eye, job.eyeBoost]);
          }
        }
      }
      root.updateMatrixWorld(true);
    };
    const restore = () => {
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
      for (const [eye, k] of scaled) eye.scale.multiplyScalar(1 / k);
      scaled.length = 0;
    };
    const aim = (cam) => {
      camera.fov = cam.fov ?? 20;
      camera.updateProjectionMatrix();
      camera.position.set(...cam.position);
      camera.lookAt(new V3(...cam.target));
      camera.updateMatrixWorld(true);
    };
    window.__begin = (n) => {
      strip = document.createElement("canvas");
      strip.width = out * n;
      strip.height = out;
      stripCtx = strip.getContext("2d");
      stripCtx.clearRect(0, 0, strip.width, strip.height);
    };
    window.__frame = (job, slot = 0) => {
      pose(job);
      let cam = job.cam;
      if (job.trackHead) {
        const hp = new V3();
        root.getObjectByName("nx-head").getWorldPosition(hp);
        const th = job.trackHead;
        const target = [hp.x + (th.dx ?? 0), hp.y + th.dy, hp.z];
        cam = { fov: 20, target, position: [target[0], target[1] + (th.lift ?? 0.05), target[2] + th.dist] };
      }
      aim(cam);
      composer.render();
      gl.finish();
      stripCtx.drawImage(canvas, slot * out, 0);
      const box = visibleBox();
      restore();
      return { min: box.min.toArray(), max: box.max.toArray() };
    };
    window.__measure = (job) => {
      pose(job);
      const box = visibleBox();
      restore();
      return { min: box.min.toArray(), max: box.max.toArray() };
    };
    window.__export = (mime, quality) => strip.toDataURL(mime, quality);
    window.__ready = true;
    console.log("[scene] multi ready", JSON.stringify(info));
    return;
  }

  window.__render = async () => {
    const t1 = performance.now();
    composer.render();
    gl.finish();
    const dataUrl = canvas.toDataURL("image/png");
    return { dataUrl, ms: Math.round(performance.now() - t1), buildMs: Math.round(t1 - t0), info };
  };
  window.__ready = true;
  console.log("[scene] ready", JSON.stringify(info));
}

main().catch((e) => {
  window.__error = String(e.stack || e);
  console.log("[scene] ERROR", window.__error);
});
