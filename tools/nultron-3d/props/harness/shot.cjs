// Offscreen capture harness for the props builder (CommonJS main so Electron can reach app.whenReady()).
//   node props/harness/run.mjs --page <html file> --out <png> [--width 1600] [--height 900] [--dpr 2] [--query "a=b"]
//                              [--gpu sw|hw] [--transparent 1] [--timeout 40000]
// (run.mjs starts the repo's Electron on this file; the trace goes to work/props-trace.txt)
// The page must set window.__ready = true when the frame is drawn (or window.__error = "message").
// Traps (same as apps/desktop/scripts/brand-icons.mjs): load a page BEFORE attaching the debugger (attaching to a window
// with no page crashes the process), capture through the DevTools screenshot (capturePage is clamped to the desktop),
// and unset ELECTRON_RUN_AS_NODE (run.mjs does).
const { app, BrowserWindow } = require("electron");
const { pathToFileURL } = require("node:url");
const { writeFileSync, mkdirSync, appendFileSync } = require("node:fs");
const path = require("node:path");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const page = path.resolve(arg("page", "sheet.html"));
const out = path.resolve(arg("out", "out.png"));
const width = Number(arg("width", 1600));
const height = Number(arg("height", 900));
const dpr = Number(arg("dpr", 2));
const query = arg("query", "");
const gpu = arg("gpu", "sw");
const transparent = arg("transparent", "0") === "1";
const timeout = Number(arg("timeout", 40000));
const trace = path.join(__dirname, "..", "..", "work", "props-trace.txt");
mkdirSync(path.dirname(trace), { recursive: true });
const LOG = (m) => appendFileSync(trace, `${m}\n`);

if (gpu === "sw") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("use-angle", "swiftshader");
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
}

const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms))]);

async function run() {
  await app.whenReady();
  LOG("ready");
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    frame: false,
    transparent,
    backgroundColor: transparent ? "#00000000" : "#ffffff",
    webPreferences: {
      offscreen: gpu === "sw",
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: false,
    },
  });
  win.webContents.on("console-message", (_e, level, message, line, source) => {
    if (message.includes("Electron Security Warning")) return;
    LOG(`[${level}] ${message} (${path.basename(source || "")}:${line})`);
  });
  await win.loadURL("data:text/html;charset=utf-8,<!doctype html><body style='margin:0'>");
  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  if (transparent) {
    await dbg.sendCommand("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  }
  const url = pathToFileURL(page).href + (query ? `?${query}` : "");
  LOG(`loading ${url}`);
  await win.loadURL(url);
  const started = Date.now();
  let state = null;
  while (Date.now() - started < timeout) {
    state = await win.webContents.executeJavaScript("({ready: !!window.__ready, error: window.__error || null})");
    if (state.ready || state.error) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  LOG(`state ${JSON.stringify(state)}`);
  await win.webContents.executeJavaScript(
    "new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 400); })",
  );
  if (state?.error) console.error("PAGE ERROR:", state.error);
  const { data } = await withTimeout(
    dbg.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    }),
    30000,
    "captureScreenshot",
  );
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(data, "base64"));
  console.log(`wrote ${out} (${width}x${height} css @${dpr}x)`);
  win.destroy();
  app.exit(state?.ready ? 0 : 1);
}
run().catch((e) => {
  console.error(e.stack || e);
  LOG(`fatal ${e.stack || e}`);
  app.exit(1);
});
