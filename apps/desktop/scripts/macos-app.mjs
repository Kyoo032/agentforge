/**
 * Launch the packaged Agentforge .app (macOS only).
 * Windows/Linux cannot run Apple's Simulator or a .app — use WinApp F5 there.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CANDIDATES = [
  path.join(desktopRoot, "dist", "mac", "Agentforge.app", "Contents", "MacOS", "Agentforge"),
  path.join(desktopRoot, "dist", "mac-arm64", "Agentforge.app", "Contents", "MacOS", "Agentforge"),
  path.join(desktopRoot, "dist", "mac-x64", "Agentforge.app", "Contents", "MacOS", "Agentforge"),
  "/Applications/Agentforge.app/Contents/MacOS/Agentforge",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail(
    [
      "Agentforge.app and Apple's Simulator require macOS.",
      `This machine is ${process.platform}. There is no macOS simulator here.`,
      "Windows: F5 WinApp (installed NSIS or win-unpacked).",
      "On a Mac: pnpm desktop:build:mac:dir then pnpm desktop:mac (or F5 Packaged Agentforge macOS .app).",
      "iOS Simulator / Expo stay parked until a mobile repo exists.",
    ].join("\n"),
  );
}

const binary = CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!binary) {
  fail(
    [
      "No Agentforge.app found.",
      "Build on this Mac: pnpm desktop:build:mac:dir",
      "Looked in:",
      ...CANDIDATES.map((candidate) => `  ${candidate}`),
    ].join("\n"),
  );
}

const child = spawn(binary, ["--remote-debugging-port=9222"], {
  stdio: "inherit",
  detached: true,
});
child.unref();
console.log(`launched ${binary}`);
