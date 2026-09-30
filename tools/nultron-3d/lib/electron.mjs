// Where things live, and how a script re-launches itself under the repo's Electron.
//
// Every entry point here (render.mjs, render-all.mjs, poses/preview.mjs, make-contact.mjs) starts under plain node, finds the
// Electron binary that `pnpm install` put under apps/desktop/node_modules, and runs itself again under it, because the
// offscreen WebGL render needs Chromium. Nothing here knows an absolute path: the repo root is two folders above this file.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** tools/nultron-3d */
export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The agentforge checkout. */
export const REPO_ROOT = resolve(TOOL_ROOT, "..", "..");
/** The package whose `electron` dependency is the binary every render uses. */
export const ELECTRON_PKG = join(REPO_ROOT, "apps", "desktop", "package.json");
/** Rizky's reference sheets and the app logo master (the modelling was measured off these). */
export const REFERENCE_DIR = join(REPO_ROOT, "docs", "internal", "brand", "nultron", "reference");
/** Where the shipped mascot images live in the app (sync-images.mjs writes here). */
export const APP_IMAGES_DIR = join(REPO_ROOT, "apps", "web", "components", "nultron", "images");

/** The path of the Electron executable (the `electron` package exports it). */
export function electronBinary() {
  try {
    return createRequire(ELECTRON_PKG)("electron");
  } catch (err) {
    throw new Error(
      `Electron is not installed under apps/desktop/node_modules (${err.message}). Run "npx pnpm@9.15.9 install" at the repo root.`,
    );
  }
}

/** Runs `entry` (an absolute path to a .mjs) under Electron with `args`; resolves with its exit code. */
export function launchElectron(entry, args) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // an IDE shell may set it, and Electron would then start as plain node
  return new Promise((resolveRun, reject) => {
    const child = spawn(electronBinary(), [entry, ...args], { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

/**
 * Chromium switches for the WebGL render, called on the Electron `app` before it is ready. Windows asks ANGLE for D3D11, which
 * is what every image in the app was rendered with; the other systems keep Chromium's own choice (not driven yet).
 */
export function applyGpuSwitches(app) {
  app.commandLine.appendSwitch("ignore-gpu-blocklist");
  app.commandLine.appendSwitch("enable-webgl");
  if (process.platform === "win32") app.commandLine.appendSwitch("use-angle", "d3d11");
}
