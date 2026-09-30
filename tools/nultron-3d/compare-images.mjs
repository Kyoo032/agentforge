#!/usr/bin/env node
// Compares two render directories file by file (full/, head/, clips/, loops/ WebP files), the way you check that a fresh render
// still matches what the app ships:
//   node compare-images.mjs <dirA> <dirB> [--json <report.json>]
// A file is "identical" when its bytes are. Otherwise both are decoded by Chromium (Electron) and compared per channel:
//   mean    average absolute difference (0..255) over the pixels that are not transparent in both pictures
//   max     largest single-channel difference anywhere
//   >16     share of those pixels where some channel differs by more than 16 (a visible change; below that is noise)
// Exit code 0 when every file is identical or its mean is under --tolerance (default 2.0), 1 otherwise, 2 for a missing file.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchElectron } from "./lib/electron.mjs";

const KINDS = ["full", "head", "clips", "loops"];

function parseArgs(argv) {
  const opts = { dirs: [], json: "", tolerance: 2 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") opts.json = resolve(argv[++i]);
    else if (argv[i] === "--tolerance") opts.tolerance = Number(argv[++i]);
    else opts.dirs.push(resolve(argv[i]));
  }
  if (opts.dirs.length !== 2) throw new Error("usage: compare-images.mjs <dirA> <dirB> [--json report.json] [--tolerance 2]");
  return opts;
}

function listImages(dir) {
  return KINDS.flatMap((kind) =>
    existsSync(join(dir, kind))
      ? readdirSync(join(dir, kind))
          .filter((name) => name.endsWith(".webp"))
          .sort()
          .map((name) => `${kind}/${name}`)
      : [],
  );
}

// Runs inside the page: decodes two WebP byte strings (base64) and returns the difference statistics.
const PAGE_COMPARE = `(async (a64, b64) => {
  const decode = async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/webp" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    ctx.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
  };
  const [A, B] = await Promise.all([decode(a64), decode(b64)]);
  if (A.w !== B.w || A.h !== B.h) return { size: [A.w, A.h, B.w, B.h] };
  let sum = 0, count = 0, max = 0, visible = 0, alphaMax = 0;
  for (let i = 0; i < A.data.length; i += 4) {
    const aa = A.data[i + 3], ba = B.data[i + 3];
    alphaMax = Math.max(alphaMax, Math.abs(aa - ba));
    if (aa === 0 && ba === 0) continue;
    let px = 0;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(A.data[i + c] - B.data[i + c]);
      sum += d;
      px = Math.max(px, d);
    }
    count++;
    max = Math.max(max, px);
    if (px > 16) visible++;
  }
  return { w: A.w, h: A.h, mean: count ? sum / (count * 4) : 0, max, visible: count ? visible / count : 0, alphaMax, pixels: count };
})`;

async function compareUnderElectron(opts) {
  const { app, BrowserWindow } = (await import("electron")).default;
  await app.whenReady();
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  await win.loadURL("about:blank");
  const [dirA, dirB] = opts.dirs;
  const namesA = listImages(dirA);
  const namesB = listImages(dirB);
  const names = [...new Set([...namesA, ...namesB])].sort();
  const rows = [];
  let missing = 0;
  for (const name of names) {
    const fa = join(dirA, name);
    const fb = join(dirB, name);
    if (!existsSync(fa) || !existsSync(fb)) {
      rows.push({ name, status: existsSync(fa) ? "only in A" : "only in B" });
      missing++;
      continue;
    }
    const a = readFileSync(fa);
    const b = readFileSync(fb);
    if (a.equals(b)) {
      rows.push({ name, status: "identical", bytesA: a.length, bytesB: b.length });
      continue;
    }
    const stats = await win.webContents.executeJavaScript(
      `${PAGE_COMPARE}(${JSON.stringify(a.toString("base64"))}, ${JSON.stringify(b.toString("base64"))})`,
    );
    rows.push({ name, status: stats.size ? "size differs" : "differs", bytesA: a.length, bytesB: b.length, ...stats });
  }
  win.destroy();

  const differing = rows.filter((r) => r.status === "differs");
  for (const r of rows.filter((row) => row.status !== "identical")) {
    console.log(
      r.status === "differs"
        ? `${r.name.padEnd(24)} bytes ${String(r.bytesA).padStart(6)} -> ${String(r.bytesB).padStart(6)}  mean ${r.mean.toFixed(3)}  max ${r.max}  >16 ${(r.visible * 100).toFixed(3)}%  alpha max ${r.alphaMax}`
        : `${r.name.padEnd(24)} ${r.status}${r.size ? ` ${JSON.stringify(r.size)}` : ""}`,
    );
  }
  const identical = rows.filter((r) => r.status === "identical").length;
  const means = differing.map((r) => r.mean);
  const summary = {
    files: rows.length,
    identical,
    differing: differing.length,
    missing,
    meanOfMeans: means.length ? +(means.reduce((x, y) => x + y, 0) / means.length).toFixed(4) : 0,
    worstMean: means.length ? +Math.max(...means).toFixed(4) : 0,
    worstMax: differing.length ? Math.max(...differing.map((r) => r.max)) : 0,
    worstVisibleShare: differing.length ? +Math.max(...differing.map((r) => r.visible)).toFixed(6) : 0,
    tolerance: opts.tolerance,
  };
  console.log(`compare-images: ${JSON.stringify(summary)}`);
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  if (missing) return 2;
  return summary.worstMean > opts.tolerance ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  if (!process.versions.electron) process.exit(await launchElectron(fileURLToPath(import.meta.url), args));
  const { app } = (await import("electron")).default;
  try {
    app.exit(await compareUnderElectron(opts));
  } catch (err) {
    console.error(`compare-images: ${err.stack ?? err}`);
    app.exit(1);
  }
}

main().catch((err) => {
  console.error(`compare-images: ${err.stack ?? err}`);
  process.exit(1);
});
