#!/usr/bin/env node
// Offline Nultron renderer.  node render.mjs --state idle --view full|head|icon --size 1024 --out file.png --bg transparent|#hex
//   extra: --yaw deg  --pitch deg  --ss 3  --exposure 1  --env 1 --key 1 --ao 1 --bloom 1 --zoom 1 --eyes name --mouth name --handl name --handr name
//   batch: --batch jobs.json   ([{ "out": "a.png", "view": "full", ... }, ...]) renders every job in one Electron session.
// Runs itself twice: under node it launches the repo's Electron (apps/desktop/node_modules, see lib/electron.mjs) on this same
// file; under Electron it renders.
// (No top-level await on the whole run: an ESM entry that awaits app.whenReady() would deadlock Electron.)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyGpuSwitches, launchElectron } from "./lib/electron.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
    o[k] = v;
  }
  return o;
}

async function renderJobs(electron, jobs, quiet) {
  const { app, BrowserWindow } = electron;
  applyGpuSwitches(app);
  await app.whenReady();
  let code = 0;
  // One hidden window for the whole batch: a second window created right after destroying the first failed to load.
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      webSecurity: false, // file:// module imports
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.on("console-message", (e, ...rest) => {
    const msg = typeof e === "object" && e && "message" in e ? e.message : rest[1];
    if (!quiet && !/Electron Security Warning|electronjs.org|^$|This warning|once the app|Policy set|this app to|X4000/.test(String(msg))) console.log("  page:", msg);
  });
  for (const job of jobs) {
    const size = Number(job.size ?? 1024);
    win.setContentSize(Math.min(size, 1024), Math.min(size, 1024));
    await win.loadURL("about:blank");
    const query = {};
    for (const [k, v] of Object.entries(job)) if (k !== "out" && k !== "batch") query[k] = String(v);
    const t0 = Date.now();
    await win.loadFile(resolve(here, "scene.html"), { query });
    const ready = await win.webContents.executeJavaScript(
      "new Promise((res)=>{const t=Date.now();const f=()=>{ if(window.__error) return res({error:window.__error}); if(window.__ready) return res({ok:true}); if(Date.now()-t>90000) return res({error:'timeout waiting for scene'}); setTimeout(f,50)};f()})",
    );
    if (ready.error) {
      console.error("scene error:", ready.error);
      code = 2;
      continue;
    }
    const result = await win.webContents.executeJavaScript("window.__render()");
    const b64 = result.dataUrl.replace(/^data:image\/png;base64,/, "");
    const outPath = resolve(job.out ?? "out.png");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, Buffer.from(b64, "base64"));
    console.log(
      `wrote ${outPath}  view=${job.view ?? "full"} state=${job.state ?? "idle"} size=${size}  render=${result.ms}ms  total=${Date.now() - t0}ms  gpu=${result.info.gpu}`,
    );
  }
  win.destroy();
  return code;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.versions.electron) {
    process.exit(await launchElectron(fileURLToPath(import.meta.url), process.argv.slice(2)));
  }
  const electron = (await import("electron")).default; // ESM entry: the API is on the default export
  const jobs = args.batch ? JSON.parse(readFileSync(resolve(args.batch), "utf8")) : [args];
  try {
    const code = await renderJobs(electron, jobs, args.quiet === "1");
    electron.app.exit(code);
  } catch (err) {
    console.error(`render: ${err.stack ?? err}`);
    electron.app.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // Not awaited on purpose (see the header).
  main().catch((err) => {
    console.error(`render: ${err.stack ?? err}`);
    process.exit(1);
  });
}
