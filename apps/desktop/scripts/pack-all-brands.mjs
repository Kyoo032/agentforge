#!/usr/bin/env node
/**
 * Build Vite renderer once, stage host, then pack every flavor that exists on disk.
 * Git tracks branding/agentforge only; other flavor folders are local/gitignored.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const brands = ["agentforge", "kemenkeu", "metranet"];

function run(cmd, args, env = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}${env.AGENTFORGE_BRAND ? ` (AGENTFORGE_BRAND=${env.AGENTFORGE_BRAND})` : ""}`);
  const result = spawnSync(cmd, args, {
    cwd: desktopRoot,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npx", ["pnpm@9.15.9", "--filter", "@agentforge/web", "build"]);
run("node", ["scripts/stage-renderer.mjs"]);

const present = brands.filter((brand) => existsSync(join(desktopRoot, "branding", brand, "brand.json")));
if (present.length === 0) {
  console.error("pack-all-brands: no branding/*/brand.json found");
  process.exit(1);
}

for (const brand of present) {
  run("node", ["scripts/pack-brand.mjs"], { AGENTFORGE_BRAND: brand });
}

console.log(`\npack-all-brands: done (${present.join(" + ")})`);
