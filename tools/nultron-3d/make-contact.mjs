#!/usr/bin/env node
// Builds <dir>/contact.png, the review sheet for a render: every state on light and dark, the heads at the real app sizes,
// every one-shot clip and every busy loop.   node make-contact.mjs [dir]      (default: tools/nultron-3d/out)
// Chromium (Electron) draws it on a canvas, so it needs nothing but the repo's Electron. It is a review aid only: nothing in the
// app reads it, and the Python original (review/make-contact.py) is not needed any more.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchElectron } from "./lib/electron.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// Runs inside the page (serialised with toString): lays the sheet out on a canvas and returns it as PNG base64.
async function pageBuildSheet({ manifest, files }) {
  const W = 1800;
  const LIGHT = "rgb(239,225,212)";
  const DARK = "rgb(20,22,28)";
  const bitmaps = {};
  for (const [rel, b64] of Object.entries(files)) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    bitmaps[rel] = await createImageBitmap(new Blob([bytes], { type: "image/webp" }));
  }
  const blocks = [];
  const block = (height, draw) => blocks.push({ height, draw });
  const label = (ctx, text, x, y, colour) => {
    ctx.fillStyle = colour;
    ctx.font = "11px monospace";
    ctx.textBaseline = "top";
    ctx.fillText(text, x, y);
  };
  const scaled = (ctx, bmp, x, y, h, smooth = true) => {
    const w = Math.max(1, Math.round((bmp.width * h) / bmp.height));
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, x, y, w, h);
    return w;
  };
  const title = (text) =>
    block(22, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, W, 22);
      label(ctx, text, 6, 5, "rgb(20,20,20)");
    });
  const grid = (items, cols, cell, bg, withLabel = true) => {
    const rows = Math.ceil(items.length / cols);
    const ch = cell + (withLabel ? 14 : 0);
    const step = Math.floor(W / cols);
    block(rows * ch, (ctx) => {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, rows * ch);
      items.forEach(([name, bmp], i) => {
        const x = (i % cols) * step;
        const y = Math.floor(i / cols) * ch;
        const w = Math.max(1, Math.round((bmp.width * cell) / bmp.height));
        scaled(ctx, bmp, x + Math.floor((step - w) / 2), y, cell);
        if (withLabel) label(ctx, name, x + 4, y + cell + 1, bg === DARK ? "rgb(200,200,200)" : "rgb(40,40,40)");
      });
    });
  };

  const states = Object.keys(manifest.full.states);
  const fulls = states.map((s) => [s, bitmaps[manifest.full.states[s]]]);
  const heads = states.map((s) => [s, bitmaps[manifest.head.states[s]]]);

  title(`full body ${manifest.full.size} (shown at 240) on light | shipped bytes ${manifest.bytes}`);
  grid(fulls, 7, 240, LIGHT);
  title("full body on dark");
  grid(fulls, 7, 240, DARK);
  title(`head close-ups ${manifest.head.size} (shown at 84): light, then dark`);
  grid(heads, 21, 84, LIGHT, false);
  grid(heads, 21, 84, DARK, false);
  title("heads at the real app sizes: 40 px then 24 px, on light and dark; last row = the 40 px versions enlarged 2x (nearest)");
  const step = Math.floor(W / 21);
  for (const bg of [LIGHT, DARK]) {
    for (const size of [40, 24]) {
      block(size + 8, (ctx) => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, size + 8);
        for (const [i, [, bmp]] of heads.entries()) scaled(ctx, bmp, i * step + 4, 4, size);
      });
    }
  }
  block(88, (ctx) => {
    ctx.fillStyle = LIGHT;
    ctx.fillRect(0, 0, W, 88);
    // the 40 px version first, then blown up without smoothing, as the app's screen would show it at 2x
    const small = new OffscreenCanvas(40, 40);
    heads.forEach(([, bmp], i) => {
      const sctx = small.getContext("2d");
      sctx.clearRect(0, 0, 40, 40);
      sctx.imageSmoothingQuality = "high";
      sctx.drawImage(bmp, 0, 0, 40, 40);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, i * step + 2, 4, 80, 80);
    });
  });

  title("one-shot clips (frames left to right, 12 fps; the last frame is the still)");
  for (const [state, clip] of Object.entries(manifest.clips)) {
    block(132, (ctx) => {
      ctx.fillStyle = LIGHT;
      ctx.fillRect(0, 0, W, 132);
      scaled(ctx, bitmaps[clip.src], 0, 2, 128);
      label(ctx, `${state}: ${clip.frames} frames, ${(clip.frames / clip.fps).toFixed(2)} s`, W - 200, 4, "rgb(40,40,40)");
    });
  }

  title("busy loops (4 frames each)");
  const loops = Object.entries(manifest.loops ?? {});
  for (let i = 0; i < loops.length; i += 3) {
    block(132, (ctx) => {
      ctx.fillStyle = LIGHT;
      ctx.fillRect(0, 0, W, 132);
      let x = 0;
      for (const [state, loop] of loops.slice(i, i + 3)) {
        const w = scaled(ctx, bitmaps[loop.src], x, 2, 128);
        label(ctx, `${state} @${loop.fps}fps`, x + 4, 4, "rgb(40,40,40)");
        x += w + 24;
      }
    });
  }

  const H = blocks.reduce((sum, b) => sum + b.height, 0);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  let y = 0;
  for (const b of blocks) {
    ctx.save();
    ctx.translate(0, y);
    ctx.beginPath();
    ctx.rect(0, 0, W, b.height);
    ctx.clip();
    b.draw(ctx);
    ctx.restore();
    y += b.height;
  }
  const png = await canvas.convertToBlob({ type: "image/png" });
  const buf = new Uint8Array(await png.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), width: W, height: H };
}

async function main() {
  const args = process.argv.slice(2);
  const dir = resolve(args[0] ?? join(here, "out"));
  if (!process.versions.electron) process.exit(await launchElectron(fileURLToPath(import.meta.url), args));
  const { app, BrowserWindow } = (await import("electron")).default;
  try {
    await app.whenReady();
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    const rels = [
      ...Object.values(manifest.full.states),
      ...Object.values(manifest.head.states),
      ...Object.values(manifest.clips ?? {}).map((c) => c.src),
      ...Object.values(manifest.loops ?? {}).map((l) => l.src),
    ];
    const files = Object.fromEntries(rels.map((rel) => [rel, readFileSync(join(dir, rel)).toString("base64")]));
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadURL("about:blank");
    const out = await win.webContents.executeJavaScript(`(${pageBuildSheet.toString()})(${JSON.stringify({ manifest, files })})`);
    const target = join(dir, "contact.png");
    writeFileSync(target, Buffer.from(out.base64, "base64"));
    console.log(`make-contact: wrote ${target} ${out.width}x${out.height}`);
    win.destroy();
    app.exit(0);
  } catch (err) {
    console.error(`make-contact: ${err.stack ?? err}`);
    app.exit(1);
  }
}

main().catch((err) => {
  console.error(`make-contact: ${err.stack ?? err}`);
  process.exit(1);
});
