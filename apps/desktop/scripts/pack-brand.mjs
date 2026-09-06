#!/usr/bin/env node
/**
 * Copy one flavor into build/ + splash/ + brand.json, then run electron-builder NSIS.
 *
 *   AGENTFORGE_BRAND=agentforge|kemenkeu|metranet node scripts/pack-brand.mjs
 *   node scripts/pack-brand.mjs --restore-public
 *
 * Requires apps/web dist + stage-renderer.mjs already run (or call via desktop-build).
 * After a non-Agentforge pack, the working tree is always restored to branding/agentforge
 * so splash/icon leftovers cannot leak into the next public build or a git commit.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const restoreOnly = process.argv.includes("--restore-public");
const brandId = restoreOnly
  ? "agentforge"
  : (process.env.AGENTFORGE_BRAND || "agentforge").trim().toLowerCase();
const brands = new Set(["agentforge", "kemenkeu", "metranet"]);

if (!brands.has(brandId)) {
  console.error(`Unknown AGENTFORGE_BRAND=${brandId}. Use agentforge | kemenkeu | metranet.`);
  process.exit(1);
}

const buildDir = join(desktopRoot, "build");
const splashDir = join(desktopRoot, "splash");
const brandResourceDir = join(desktopRoot, "resources", "brand");
mkdirSync(buildDir, { recursive: true });
mkdirSync(splashDir, { recursive: true });
mkdirSync(brandResourceDir, { recursive: true });

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function writeSplash(config) {
  const title = escapeHtml(config.productName);
  const blurb = escapeHtml(config.splashBlurb);
  writeFileSync(
    join(splashDir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: #0d2137;
        color: #e8eef5;
        display: flex;
        min-height: 100vh;
        align-items: center;
        justify-content: center;
      }
      main {
        max-width: 28rem;
        padding: 2rem;
        text-align: center;
      }
      .logo {
        width: auto;
        max-width: 9rem;
        max-height: 5.5rem;
        object-fit: contain;
        margin: 0 auto 1.25rem;
        display: block;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.75rem;
        font-weight: 650;
        letter-spacing: 0.01em;
      }
      p {
        color: #8aa0b8;
        line-height: 1.5;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <img class="logo" src="./logo.png" alt="" width="144" height="144" />
      <h1>${title}</h1>
      <p>${blurb}</p>
    </main>
  </body>
</html>
`,
    "utf8",
  );
}

function applyBrandToWorkingTree(id) {
  const brandDir = join(desktopRoot, "branding", id);
  const brandFile = join(brandDir, "brand.json");
  if (!existsSync(brandFile)) {
    console.error(`Missing ${brandFile}`);
    process.exit(1);
  }
  const brand = JSON.parse(readFileSync(brandFile, "utf8"));
  if (!brand.productName || !brand.appId || !brand.artifactName || !brand.gatewayBaseUrl) {
    console.error(`brand.json for ${id} is missing productName, appId, artifactName, or gatewayBaseUrl`);
    process.exit(1);
  }
  const iconSrc = join(brandDir, "icon.ico");
  const logoPng = join(brandDir, "logo.png");
  const logoSvg = join(brandDir, "logo.svg");
  const splashPng = join(brandDir, "splash.png");
  if (!existsSync(iconSrc)) {
    console.error(`Missing ${iconSrc}`);
    process.exit(1);
  }
  for (const name of readdirSync(splashDir)) {
    if (/^(logo|icon|splash)\./i.test(name)) {
      unlinkSync(join(splashDir, name));
    }
  }
  copyFileSync(iconSrc, join(buildDir, "icon.ico"));
  copyFileSync(iconSrc, join(splashDir, "icon.ico"));
  copyFileSync(brandFile, join(brandResourceDir, "brand.json"));
  const splashImg = existsSync(logoPng) ? logoPng : existsSync(splashPng) ? splashPng : null;
  if (!splashImg) {
    console.error(`Missing logo.png/splash.png in ${brandDir}`);
    process.exit(1);
  }
  copyFileSync(splashImg, join(splashDir, "logo.png"));
  copyFileSync(splashImg, join(brandResourceDir, "logo.png"));
  if (existsSync(logoSvg)) {
    copyFileSync(logoSvg, join(splashDir, "logo.svg"));
  }
  writeSplash(brand);
  return brand;
}

function restorePublicBrand() {
  const brand = applyBrandToWorkingTree("agentforge");
  console.log(`pack-brand: restored public working tree to "${brand.productName}"`);
}

if (restoreOnly) {
  restorePublicBrand();
  process.exit(0);
}

const brand = applyBrandToWorkingTree(brandId);
console.log(
  `pack-brand: flavor=${brandId} product="${brand.productName}" gateway=${brand.gatewayBaseUrl} artifact="${brand.artifactName}"`,
);

const electronBuilderCli = require.resolve("electron-builder/cli.js", {
  paths: [desktopRoot],
});
const args = [
  electronBuilderCli,
  "--win",
  "nsis",
  `--publish`,
  `never`,
  `-c.artifactName=${brand.artifactName}`,
  `-c.productName=${brand.productName}`,
  `-c.appId=${brand.appId}`,
  "-c.win.icon=icon.ico",
];
if (brandId === "agentforge") {
  args.push(
    "-c.publish.provider=github",
    "-c.publish.owner=Kyoo032",
    "-c.publish.repo=agentforge",
  );
} else {
  args.push("-c.publish.provider=generic", "-c.publish.url=https://localhost/disabled-updates");
}

const result = spawnSync(process.execPath, args, {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    AGENTFORGE_BRAND: brandId,
  },
});

restorePublicBrand();

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (brandId === "agentforge") {
  const latestPath = join(desktopRoot, "dist", "latest.yml");
  if (existsSync(latestPath)) {
    const pkg = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
    const version = typeof pkg.version === "string" ? pkg.version : "0.14.0";
    const spaced = `Agentforge Setup ${version}.exe`;
    const raw = readFileSync(latestPath, "utf8");
    const next = raw
      .replace(/Agentforge-Setup-[0-9.]+\\.exe/g, spaced)
      .replace(/^path: .+$/m, `path: ${spaced}`);
    if (next !== raw) {
      writeFileSync(latestPath, next);
      console.log(`pack-brand: rewrote latest.yml artifact to "${spaced}"`);
    }
  }
}
