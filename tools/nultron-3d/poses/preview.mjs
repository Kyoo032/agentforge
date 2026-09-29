#!/usr/bin/env node
// Poser's preview harness: renders posed Nultron sheets/strips to PNG through an offscreen Electron window.
// Pattern from apps/desktop/scripts/brand-icons.mjs (node re-launches itself under Electron; the screenshot is taken
// through the DevTools protocol so it is not clamped to the desktop size). A tiny loopback http server serves this
// workspace so the ES modules and poses.json load. Never touches the repo; the log goes to work/poses-run.log.
//
//   node poses/preview.mjs --out work/poses/sheet.png --query "model=real&view=front"
//
// query (see preview.js): model=proxy|real  view=front|34|side  states=a,b,c  cols=7  tw=360 th=420
//                         strip=N&t0=0&t1=1.0 (one state at N times)  mode=clip|loop  label=1|0  fit=full|head
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchElectron } from "../lib/electron.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

const LOG_FILE = join(ROOT, "work", "poses-run.log");
function dlog(msg) {
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `${line}\n`);
  } catch {}
  console.log(line);
}

const MIME = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css",
};

function parseArgs(argv) {
  const o = { out: "", query: "", w: 0, h: 0, timeout: 180000 };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    const v = argv[i + 1];
    if (f === "--out") o.out = resolve(v);
    else if (f === "--query") o.query = v;
    else if (f === "--w") o.w = Number(v);
    else if (f === "--h") o.h = Number(v);
    else if (f === "--timeout") o.timeout = Number(v);
    else throw new Error(`unknown argument ${f}`);
    i++;
  }
  if (!o.out) throw new Error("--out is required");
  return o;
}

function serve() {
  return new Promise((res) => {
    const srv = createServer(async (req, rsp) => {
      try {
        const url = new URL(req.url, "http://x");
        const file = join(ROOT, normalize(decodeURIComponent(url.pathname)));
        if (!file.startsWith(ROOT)) {
          rsp.writeHead(403).end();
          return;
        }
        const data = await readFile(file);
        rsp.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
        rsp.end(data);
      } catch {
        rsp.writeHead(404).end();
      }
    });
    srv.listen(0, "127.0.0.1", () => res(srv));
  });
}

async function capture(opts) {
  const electron = (await import("electron")).default;
  const { app, BrowserWindow } = electron;
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  await app.whenReady();
  dlog("electron ready");
  const srv = await serve();
  const port = srv.address().port;
  dlog(`serving on ${port}`);
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2 || /nultron|error|fail/i.test(message)) dlog(`[page:${level}] ${message}`);
  });
  await win.loadURL("data:text/html;charset=utf-8,<!doctype html><body style='margin:0;background:transparent'>");
  dlog("blank page loaded");
  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  dlog("debugger attached");
  await dbg.sendCommand("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const url = `http://127.0.0.1:${port}/poses/preview.html?${opts.query}`;
  // The page reports its own size; load it first at a nominal size, read __size, then resize and wait for render.
  await dbg.sendCommand("Emulation.setDeviceMetricsOverride", {
    width: opts.w || 1600,
    height: opts.h || 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  dlog(`loading ${url}`);
  await win.loadURL(url);
  dlog("page loaded");
  const started = Date.now();
  let size = null;
  for (;;) {
    const st = await win.webContents.executeJavaScript("({ ready: window.__ready === true, error: window.__error ?? null, size: window.__size ?? null, log: window.__log ?? null })");
    if (st.error) throw new Error(`page error: ${st.error}`);
    if (st.ready) {
      size = st.size;
      if (st.log) console.log(st.log);
      break;
    }
    if (Date.now() - started > opts.timeout) throw new Error("timed out waiting for the page");
    await new Promise((r) => setTimeout(r, 150));
  }
  const { w, h } = size;
  await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 400));
  const { data } = await dbg.sendCommand("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
  });
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, Buffer.from(data, "base64"));
  dlog(`preview: wrote ${opts.out} (${w}x${h})`);
  srv.close();
  win.destroy();
}

async function main() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  if (!process.versions.electron) process.exit(await launchElectron(fileURLToPath(import.meta.url), args));
  const { app } = (await import("electron")).default;
  try {
    await capture(opts);
    app.exit(0);
  } catch (err) {
    dlog(`preview: ${err.stack ?? err}`);
    app.exit(1);
  }
}

main().catch((err) => {
  console.error(`preview: ${err.stack ?? err}`);
  process.exit(1);
});
