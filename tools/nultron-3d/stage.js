// Studio for the offline render (owner: modeller): image-based light from soft boxes, key/fill/rim, ground shadow.
import * as THREE from "three";

function softRectTexture(w = 256, h = 256, feather = 28, radius = 48) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  g.filter = `blur(${feather}px)`;
  g.fillStyle = "#fff";
  const m = feather * 1.6;
  g.beginPath();
  g.roundRect(m, m, w - 2 * m, h - 2 * m, radius);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  return t;
}

export function studioEnvironment(renderer, opts = {}) {
  const { keyI = 5.2, fillI = 1.5, topI = 1.1, rimI = 4.2, baseK = 1 } = opts;
  const env = new THREE.Scene();
  const geo = new THREE.SphereGeometry(40, 64, 40);
  const pos = geo.attributes.position;
  const col = [];
  const top = new THREE.Color(0.66, 0.7, 0.78).multiplyScalar(baseK);
  const hor = new THREE.Color(0.56, 0.55, 0.55).multiplyScalar(baseK);
  const bot = new THREE.Color(0.4, 0.365, 0.33).multiplyScalar(baseK);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 40;
    if (y >= 0) c.copy(hor).lerp(top, y ** 0.7);
    else c.copy(hor).lerp(bot, (-y) ** 0.6);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const tex = softRectTexture();
  const box = (w, h, [r, g, b], intensity, at) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: tex,
        color: new THREE.Color(r * intensity, g * intensity, b * intensity),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(...at);
    m.lookAt(0, 1.1, 0);
    env.add(m);
  };
  box(11, 8, [1, 0.97, 0.92], keyI, [-7.5, 7.5, 8.5]); // key softbox, upper left front
  box(6, 9, [0.9, 0.95, 1], fillI, [10, 3.5, 5.5]); // fill strip, right
  box(9, 9, [1, 1, 1], topI, [0, 13, 1]); // top
  box(3.6, 10, [1, 0.98, 0.95], rimI * 0.55, [6.5, 4, -9.5]); // rim strip, back right
  box(3.6, 10, [0.9, 0.95, 1], rimI * 0.35, [-8.5, 4, -8.5]); // rim strip, back left
  box(13, 3.2, [1, 0.96, 0.92], 0.9, [0, 1.2, 11.5]); // low front fill
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.035, 0.1, 100);
  pm.dispose();
  return rt.texture;
}

function radialAlpha(size = 256, power = 1.6) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const a = Math.max(0, 1 - t) ** power;
    const v = Math.round(255 * a);
    grad.addColorStop(t, `rgb(${v},${v},${v})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  return t;
}

export function groundAndShadow(scene, { y = 0, icon = false, shadow = 1 } = {}) {
  const group = new THREE.Group();
  group.userData.noAO = true;
  const alpha = radialAlpha(256, 1.5);
  const blob = (opacity, sx, sz, x, z, power = 1) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x1a2038,
        transparent: true,
        opacity: opacity * shadow,
        alphaMap: power === 1 ? alpha : radialAlpha(256, power),
        depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y + 0.002, z);
    m.scale.set(sx, sz, 1);
    m.userData.noAO = true;
    m.renderOrder = -1;
    group.add(m);
  };
  if (icon) {
    blob(0.5, 1.7, 0.8, 0.12, 0.0, 1.4);
  } else {
    blob(0.5, 1.5, 0.62, 0.22, 0.02, 1.3); // wide soft shadow, drifting to the right like the reference
    blob(0.55, 0.95, 0.42, 0.02, 0.05, 1.2); // contact shadow under the boots
  }
  scene.add(group);
  return group;
}

export function addLights(scene, { key = 1, view = "full", front: frontK = 1, shadowMap = true } = {}) {
  const k = new THREE.DirectionalLight(0xfff3e6, 1.9 * key);
  k.position.set(-3.4, 5.6, 5.2);
  k.target.position.set(0, 1.1, 0);
  k.castShadow = shadowMap;
  k.shadow.mapSize.set(4096, 4096);
  const s = view === "full" ? 1.8 : 1.4;
  Object.assign(k.shadow.camera, { left: -s, right: s, top: s + 0.6, bottom: -s + 0.4, near: 1, far: 20 });
  k.shadow.bias = -0.0006;
  k.shadow.normalBias = 0.03;
  k.shadow.radius = 10;
  k.shadow.intensity = 0.6; // gentle self-shadowing: no dark ring under the bezel
  scene.add(k, k.target);
  const fill = new THREE.DirectionalLight(0xdcecff, 0.55 * key);
  fill.position.set(5, 2.4, 4);
  fill.target.position.set(0, 1.0, 0);
  scene.add(fill, fill.target);
  const front = new THREE.DirectionalLight(0xfff6ec, 0.7 * frontK); // soft frontal fill: keeps the cream plate bright
  front.position.set(-0.6, 1.6, 8);
  front.target.position.set(0, 1.2, 0);
  scene.add(front, front.target);
  const rim = new THREE.DirectionalLight(0xffffff, 0.45 * key);
  rim.position.set(3.5, 3.5, -5);
  rim.target.position.set(0, 1.2, 0);
  scene.add(rim, rim.target);
}
