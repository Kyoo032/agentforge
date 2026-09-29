// Canvas-drawn textures for the props (holo screen content, the rocket picture, stripes). No fonts anywhere: every glyph
// is drawn from strokes and shapes. Each texture is built lazily once and shared.
import * as THREE from "three";

const HAS_DOM = typeof document !== "undefined";
const cache = new Map();

function canvasTex(key, w, h, draw, { repeatX = false } = {}) {
  if (!HAS_DOM) return null;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  if (repeatX) tex.wrapS = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

function rr(ctx, x, y, w, h, r) {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}

// Deterministic pseudo-random so a rebuilt texture is identical.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sparkle(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

/** Soft round glow: white in the middle, fading to nothing. Tint it with the material colour. */
export function glowTex() {
  return canvasTex("glow", 256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(0.55, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

/** The rocket picture from the reference: navy starfield, white rocket with a blue nose, warm fins and flame. */
export function rocketTex() {
  return canvasTex("rocket", 640, 512, (ctx, W, H) => {
    rr(ctx, 0, 0, W, H, 30);
    ctx.clip();
    const sky = ctx.createLinearGradient(0, 0, W, H);
    sky.addColorStop(0, "#1a3f80");
    sky.addColorStop(0.55, "#0f2a5e");
    sky.addColorStop(1, "#153673");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.22, H * 0.95, 10, W * 0.22, H * 0.95, W * 0.6);
    glow.addColorStop(0, "rgba(255,196,120,0.75)");
    glow.addColorStop(0.5, "rgba(255,170,90,0.22)");
    glow.addColorStop(1, "rgba(255,170,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    const rand = rng(11);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.6})`;
      ctx.beginPath();
      ctx.arc(rand() * W, rand() * H, 0.8 + rand() * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [x, y, r] of [
      [0.14, 0.2, 20],
      [0.84, 0.16, 12],
      [0.92, 0.42, 17],
      [0.74, 0.86, 18],
      [0.4, 0.06, 10],
    ]) {
      sparkle(ctx, W * x, H * y, r, "#ffe7a0");
    }
    // smoke + flame
    ctx.fillStyle = "rgba(246,214,170,0.9)";
    for (const [x, y, r] of [
      [0.12, 0.86, 44],
      [0.22, 0.92, 52],
      [0.32, 0.9, 40],
      [0.08, 0.98, 40],
    ]) {
      ctx.beginPath();
      ctx.arc(W * x, H * y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(W * 0.55, H * 0.5);
    ctx.rotate((38 * Math.PI) / 180);
    const flame = ctx.createLinearGradient(0, 90, 0, 250);
    flame.addColorStop(0, "#fff6c8");
    flame.addColorStop(0.35, "#ffd05a");
    flame.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-30, 88);
    ctx.quadraticCurveTo(-46, 170, 0, 250);
    ctx.quadraticCurveTo(46, 170, 30, 88);
    ctx.closePath();
    ctx.fill();
    // fins
    ctx.fillStyle = "#b8573a";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 40, 20);
      ctx.quadraticCurveTo(s * 100, 46, s * 96, 118);
      ctx.quadraticCurveTo(s * 66, 96, s * 42, 84);
      ctx.closePath();
      ctx.fill();
    }
    // hull
    const hull = ctx.createLinearGradient(-50, 0, 50, 0);
    hull.addColorStop(0, "#ffffff");
    hull.addColorStop(0.6, "#eef0f6");
    hull.addColorStop(1, "#c6cadb");
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(0, -170);
    ctx.bezierCurveTo(60, -110, 60, 10, 46, 84);
    ctx.lineTo(-46, 84);
    ctx.bezierCurveTo(-60, 10, -60, -110, 0, -170);
    ctx.closePath();
    ctx.fill();
    // nose cone
    ctx.fillStyle = "#2c6fb8";
    ctx.beginPath();
    ctx.moveTo(0, -170);
    ctx.bezierCurveTo(30, -145, 42, -112, 46, -88);
    ctx.quadraticCurveTo(0, -70, -46, -88);
    ctx.bezierCurveTo(-42, -112, -30, -145, 0, -170);
    ctx.closePath();
    ctx.fill();
    // window
    ctx.fillStyle = "#f6f7fb";
    ctx.beginPath();
    ctx.arc(0, -22, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a78c4";
    ctx.beginPath();
    ctx.arc(0, -22, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(-7, -30, 6, 0, Math.PI * 2);
    ctx.fill();
    // nozzle
    ctx.fillStyle = "#5b4038";
    rr(ctx, -28, 84, 56, 22, 6);
    ctx.fill();
    ctx.restore();
  });
}

/** Holo bar chart: axes, faint grid, five cyan bars, a white trend line. Transparent background. */
export function chartTex() {
  return canvasTex("chart", 512, 352, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(172,239,239,0.28)";
    ctx.lineWidth = 3;
    for (let i = 1; i <= 3; i++) {
      const y = 46 + (i * (H - 110)) / 3;
      ctx.beginPath();
      ctx.moveTo(56, y);
      ctx.lineTo(W - 34, y);
      ctx.stroke();
    }
    const heights = [0.32, 0.5, 0.4, 0.72, 0.94];
    const bw = 58;
    const gap = 26;
    const x0 = 78;
    const base = H - 64;
    const top = 60;
    const pts = [];
    heights.forEach((v, i) => {
      const x = x0 + i * (bw + gap);
      const h = (base - top) * v;
      const g = ctx.createLinearGradient(0, base - h, 0, base);
      g.addColorStop(0, "#9cf1f4");
      g.addColorStop(1, "#27b5d2");
      ctx.fillStyle = g;
      rr(ctx, x, base - h, bw, h, 8);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      rr(ctx, x + 6, base - h + 5, bw - 12, 6, 3);
      ctx.fill();
      pts.push([x + bw / 2, base - h - 20]);
    });
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [i, [x, y]] of pts.entries()) {
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    for (const [x, y] of pts) {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#c9fbfb";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(52, 34);
    ctx.lineTo(52, base + 8);
    ctx.lineTo(W - 30, base + 8);
    ctx.stroke();
  });
}

/** A tiny browser-window card (decorative holo window). `variant` 0 has a picture block, 1 has two columns. */
export function cardTex(variant = 0) {
  return canvasTex(`card${variant}`, 384, 288, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(96,168,232,0.85)";
    rr(ctx, 14, 14, W - 28, 44, 10);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(38 + i * 22, 36, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    rr(ctx, 120, 27, W - 160, 18, 9);
    ctx.fill();
    ctx.strokeStyle = "rgba(120,190,240,0.9)";
    ctx.fillStyle = "rgba(120,190,240,0.32)";
    ctx.lineWidth = 5;
    if (variant === 0) {
      rr(ctx, 26, 80, 150, 110, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(70, 118, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(38, 180);
      ctx.lineTo(90, 132);
      ctx.lineTo(120, 162);
      ctx.lineTo(146, 140);
      ctx.lineTo(164, 180);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        rr(ctx, 196, 88 + i * 26, 160 - (i % 2) * 40, 12, 6);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      rr(ctx, 26, 210, W - 52, 14, 7);
      ctx.fill();
      rr(ctx, 26, 236, W - 120, 14, 7);
      ctx.fill();
    } else {
      for (let c = 0; c < 2; c++) {
        rr(ctx, 26 + c * 172, 80, 158, 92, 12);
        ctx.fillStyle = "rgba(120,190,240,0.28)";
        ctx.fill();
        ctx.stroke();
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = "rgba(255,255,255,0.62)";
          rr(ctx, 42 + c * 172, 98 + i * 22, 126 - i * 24, 11, 5);
          ctx.fill();
        }
      }
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let i = 0; i < 3; i++) {
        rr(ctx, 26, 196 + i * 26, W - 52 - i * 60, 14, 7);
        ctx.fill();
      }
    }
  });
}

/** Presentation board: title block, bullet lines, a pie and small bars. Transparent background. */
export function boardTex() {
  return canvasTex("board", 640, 448, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    rr(ctx, 44, 40, 300, 40, 14);
    ctx.fill();
    ctx.fillStyle = "rgba(172,239,239,0.7)";
    rr(ctx, 44, 96, 190, 16, 8);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = "rgba(56,198,222,0.95)";
      ctx.beginPath();
      ctx.arc(58, 158 + i * 46, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      rr(ctx, 84, 149 + i * 46, 230 - (i % 3) * 36, 17, 8);
      ctx.fill();
    }
    const cx = 480;
    const cy = 168;
    const R = 84;
    const slices = [
      [0.42, "#38C6DE"],
      [0.33, "#ACEFEF"],
      [0.25, "#ffffff"],
    ];
    let a = -Math.PI / 2;
    for (const [share, colour] of slices) {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a, a + share * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      a += share * Math.PI * 2;
    }
    ctx.strokeStyle = "rgba(20,90,140,0.55)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    [0.4, 0.62, 0.5, 0.85].forEach((v, i) => {
      ctx.fillStyle = "rgba(172,239,239,0.92)";
      rr(ctx, 404 + i * 46, 392 - 96 * v, 32, 96 * v, 6);
      ctx.fill();
    });
  });
}

/** Tileable holo ring band: segment ticks and small blocks, bright top and bottom lines. */
export function ringBandTex() {
  return canvasTex(
    "ringband",
    1024,
    128,
    (ctx, W, H) => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(70,205,228,0.34)";
      ctx.fillRect(0, 0, W, H);
      const rand = rng(5);
      for (let x = 0; x < W; x += 64) {
        ctx.fillStyle = "rgba(40,180,208,0.9)";
        ctx.fillRect(x, 0, 5, H);
        for (let j = 0; j < 3; j++) {
          if (rand() < 0.7) {
            ctx.fillStyle = `rgba(170,244,250,${0.3 + rand() * 0.5})`;
            ctx.fillRect(x + 10 + rand() * 20, 20 + j * 34, 14 + rand() * 24, 16);
          }
        }
      }
      ctx.fillStyle = "rgba(60,200,225,0.95)";
      ctx.fillRect(0, 0, W, 10);
      ctx.fillRect(0, H - 10, W, 10);
    },
    { repeatX: true },
  );
}

/** Clapperboard arm: diagonal black and white bars. */
export function clapStripeTex() {
  return canvasTex("clapstripe", 512, 96, (ctx, W, H) => {
    ctx.fillStyle = "#f8f2e8";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#232427";
    const step = 64;
    for (let x = -H; x < W + H; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, H);
      ctx.lineTo(x + 30, H);
      ctx.lineTo(x + 30 + H * 0.55, 0);
      ctx.lineTo(x + H * 0.55, 0);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/** Clapperboard face: empty fields drawn as light lines on the dark board. */
export function clapBoardTex() {
  return canvasTex("clapboard", 512, 352, (ctx, W, H) => {
    ctx.fillStyle = "#26282c";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(248,242,232,0.9)";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (const y of [78, 158, 238]) {
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(W - 24, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(W * 0.5, 78);
    ctx.lineTo(W * 0.5, 318);
    ctx.stroke();
    ctx.strokeStyle = "rgba(248,242,232,0.35)";
    ctx.lineWidth = 8;
    for (const [x, y, l] of [
      [48, 118, 160],
      [290, 118, 150],
      [48, 198, 120],
      [290, 198, 170],
      [48, 278, 190],
      [290, 278, 100],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + l, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#38C6DE";
    ctx.beginPath();
    ctx.arc(W - 46, 40, 14, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Tablet screen: deep-blue panel with a cyan pen scribble and a few icons. */
export function tabletTex() {
  return canvasTex("tablet", 512, 352, (ctx, W, H) => {
    rr(ctx, 0, 0, W, H, 26);
    ctx.clip();
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#1d5aa6");
    g.addColorStop(1, "#0f3672");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    rr(ctx, 20, 20, W - 40, 34, 12);
    ctx.fill();
    ctx.strokeStyle = "#7ff1f2";
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(60, 200);
    ctx.bezierCurveTo(100, 110, 140, 130, 150, 190);
    ctx.bezierCurveTo(160, 250, 210, 250, 230, 170);
    ctx.bezierCurveTo(250, 100, 300, 120, 310, 180);
    ctx.bezierCurveTo(320, 236, 380, 240, 440, 150);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(60, 290);
    ctx.lineTo(300, 290);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(60, 316);
    ctx.lineTo(210, 316);
    ctx.stroke();
  });
}

/** Clipboard paper: faint rules and empty check boxes (the big check is real geometry). */
export function paperTex() {
  return canvasTex("paper", 384, 512, (ctx, W, H) => {
    ctx.fillStyle = "#fbf8f1";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#9fb7cf";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const y = 150 + i * 84;
      rr(ctx, 44, y - 22, 44, 44, 10);
      ctx.strokeStyle = "#5f9bd0";
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = "#c1d2e2";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(116, y);
      ctx.lineTo(W - 50 - (i % 2) * 60, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#cfdeec";
    rr(ctx, 44, 40, 190, 26, 13);
    ctx.fill();
  });
}

/** Seven-segment display: draws `digits` (0-9 or "-") in glowing cyan on transparent. */
export function segDisplayTex(digits) {
  return canvasTex(`seg${digits}`, 512, 160, (ctx, W, H) => {
    ctx.clearRect(0, 0, W, H);
    const SEG = {
      0: "abcdef",
      1: "bc",
      2: "abged",
      3: "abgcd",
      4: "fgbc",
      5: "afgcd",
      6: "afgedc",
      7: "abc",
      8: "abcdefg",
      9: "abcdfg",
      "-": "g",
    };
    const dw = 78;
    const dh = 118;
    const t = 15;
    const gapX = 26;
    const total = digits.length * dw + (digits.length - 1) * gapX;
    let x = W - 34 - total;
    ctx.fillStyle = "#7ff1f2";
    for (const ch of digits) {
      const on = SEG[ch] ?? "";
      const y = (H - dh) / 2;
      const bar = (px, py, w, h) => {
        rr(ctx, px, py, w, h, Math.min(w, h) / 2);
        ctx.fill();
      };
      if (on.includes("a")) bar(x + t / 2, y, dw - t, t);
      if (on.includes("g")) bar(x + t / 2, y + dh / 2 - t / 2, dw - t, t);
      if (on.includes("d")) bar(x + t / 2, y + dh - t, dw - t, t);
      if (on.includes("f")) bar(x, y + t / 2, t, dh / 2 - t);
      if (on.includes("b")) bar(x + dw - t, y + t / 2, t, dh / 2 - t);
      if (on.includes("e")) bar(x, y + dh / 2 + t / 2, t, dh / 2 - t);
      if (on.includes("c")) bar(x + dw - t, y + dh / 2 + t / 2, t, dh / 2 - t);
      x += dw + gapX;
    }
  });
}
