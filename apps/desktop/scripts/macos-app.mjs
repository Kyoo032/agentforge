/**
 * Launch the packaged DPSBuddy .app (macOS only).
 * Windows/Linux cannot run Apple's Simulator or a .app — use WinApp F5 there.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CANDIDATES = [
  path.join(desktopRoot, "dist", "mac", "DPSBuddy.app", "Contents", "MacOS", "DPSBuddy"),
  path.join(desktopRoot, "dist", "mac-arm64", "DPSBuddy.app", "Contents", "MacOS", "DPSBuddy"),
  path.join(desktopRoot, "dist", "mac-x64", "DPSBuddy.app", "Contents", "MacOS", "DPSBuddy"),
  "/Applications/DPSBuddy.app/Contents/MacOS/DPSBuddy",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail(
    [
      "DPSBuddy.app and Apple's Simulator require macOS.",
      `This machine is ${process.platform}. There is no macOS simulator here.`,
      "Windows: F5 WinApp (installed NSIS or win-unpacked).",
      "On a Mac: pnpm desktop:build:mac:dir then pnpm desktop:mac (or F5 Packaged DPSBuddy macOS .app).",
      "iOS Simulator / Expo stay parked until a mobile repo exists.",
    ].join("\n"),
  );
}

const binary = CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!binary) {
  fail(
    [
      "No DPSBuddy.app found.",
      "Build on this Mac: pnpm desktop:build:mac:dir",
      "Looked in:",
      ...CANDIDATES.map((candidate) => `  ${candidate}`),
    ].join("\n"),
  );
}

if (process.argv.includes("--check")) {
  console.log(binary);
  process.exit(0);
}

// No --remote-debugging-port: a packaged build exits(1) on any debugger switch (lifecycle.hasDebugSwitch),
// because the main process holds the decrypted gateway key. Inspect the renderer in webdev instead.
const child = spawn(binary, [], {
  stdio: "inherit",
  detached: true,
});
child.unref();
console.log(`launched ${binary}`);
