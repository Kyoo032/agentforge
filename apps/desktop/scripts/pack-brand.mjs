#!/usr/bin/env node
/**
 * Copy one flavor into build/ + splash/, then run electron-builder NSIS.
 *
 *   AGENTFORGE_BRAND=agentforge|kemenkeu|metranet node scripts/pack-brand.mjs
 *
 * Requires apps/web dist + stage-renderer.mjs already run (or call via desktop-build).
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = (process.env.AGENTFORGE_BRAND || "agentforge").trim().toLowerCase();
const brands = new Set(["agentforge", "kemenkeu", "metranet"]);

if (!brands.has(brand)) {
  console.error(`Unknown AGENTFORGE_BRAND=${brand}. Use agentforge | kemenkeu | metranet.`);
  process.exit(1);
}

const artifactName = {
  agentforge: "Agentforge Setup ${version}.exe",
  kemenkeu: "Agentforge-Kemenkeu Setup ${version}.exe",
  metranet: "Agentforge-Metranet Setup ${version}.exe",
}[brand];

const brandDir = join(desktopRoot, "branding", brand);
const iconSrc = join(brandDir, "icon.ico");
const logoPng = join(brandDir, "logo.png");
const logoSvg = join(brandDir, "logo.svg");
const splashPng = join(brandDir, "splash.png");

if (!existsSync(iconSrc)) {
  console.error(`Missing ${iconSrc}`);
  process.exit(1);
}

const buildDir = join(desktopRoot, "build");
const splashDir = join(desktopRoot, "splash");
mkdirSync(buildDir, { recursive: true });
mkdirSync(splashDir, { recursive: true });

// Wipe prior flavor marks from splash so public never inherits ministry/Metranet files.
for (const name of readdirSync(splashDir)) {
  if (/^(logo|icon|splash)\./i.test(name)) {
    unlinkSync(join(splashDir, name));
  }
}

copyFileSync(iconSrc, join(buildDir, "icon.ico"));
copyFileSync(iconSrc, join(splashDir, "icon.ico"));

const splashImg = existsSync(logoPng)
  ? logoPng
  : existsSync(splashPng)
    ? splashPng
    : null;
if (!splashImg) {
  console.error(`Missing logo.png/splash.png in ${brandDir}`);
  process.exit(1);
}
copyFileSync(splashImg, join(splashDir, "logo.png"));
if (existsSync(logoSvg)) {
  copyFileSync(logoSvg, join(splashDir, "logo.svg"));
}

console.log(`pack-brand: flavor=${brand} artifact="${artifactName}"`);

const electronBuilderCli = require.resolve("electron-builder/cli.js", {
  paths: [desktopRoot],
});
const args = [
  electronBuilderCli,
  "--win",
  "nsis",
  `-c.artifactName=${artifactName}`,
  "-c.win.icon=icon.ico",
];

const result = spawnSync(process.execPath, args, {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    AGENTFORGE_BRAND: brand,
  },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
