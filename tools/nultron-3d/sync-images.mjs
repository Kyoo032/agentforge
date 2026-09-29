#!/usr/bin/env node
// Puts a render into the app: copies full/, head/, clips/, loops/ and manifest.json from a render directory into
// apps/web/components/nultron/images/, after checking the set against what the app expects (lib/app-contract.mjs reads
// mascot-states.ts, nx-image-manifest.ts and globals.css, so the rules are the app's own, not a copy).
//
//   node sync-images.mjs <dir>            check the set, then copy what differs and delete what the manifest no longer names
//   node sync-images.mjs <dir> --check    check only: report what would change, write nothing (exit 1 on any error)
//   options: --app-images <dir>  target folder (default: the app's images/)     --repo <root>  read the contract from another checkout
//
// A file that is byte-identical to the one in the app is left alone. images/README.md is never touched, and nothing outside the
// four folders and manifest.json is ever written or deleted. Plain node, no Electron: render first (render-all.mjs), then this.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { APP_IMAGES_DIR, REPO_ROOT } from "./lib/electron.mjs";
import { readAppContract } from "./lib/app-contract.mjs";
import { checkImageSet, manifestFiles } from "./lib/manifest-check.mjs";

const KINDS = ["full", "head", "clips", "loops"];

function parseArgs(argv) {
  const opts = { dir: "", check: false, appImages: APP_IMAGES_DIR, repo: REPO_ROOT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") opts.check = true;
    else if (a === "--app-images") opts.appImages = resolve(argv[++i] ?? "");
    else if (a === "--repo") opts.repo = resolve(argv[++i] ?? "");
    else if (a.startsWith("--")) throw new Error(`unknown argument ${a}`);
    else opts.dir = resolve(a);
  }
  if (!opts.dir) throw new Error("usage: sync-images.mjs <render dir> [--check] [--app-images <dir>] [--repo <root>]");
  return opts;
}

const walk = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    : [];

/** Files currently in the app folder that belong to the image set (the four folders), relative and slash-separated. */
function presentInApp(appImages) {
  return KINDS.flatMap((kind) => walk(join(appImages, kind)))
    .map((f) => relative(appImages, f).replace(/\\/g, "/"))
    .sort();
}

/** What a sync would do: copy (new or changed), keep (identical), remove (no longer named). */
export function planSync(dir, appImages, manifest) {
  const wanted = [...new Set(manifestFiles(manifest))].sort();
  const present = new Set(presentInApp(appImages));
  const copy = [];
  const keep = [];
  for (const rel of wanted) {
    const target = join(appImages, rel);
    if (present.has(rel) && readFileSync(target).equals(readFileSync(join(dir, rel)))) keep.push(rel);
    else copy.push({ rel, isNew: !present.has(rel) });
  }
  const remove = [...present].filter((rel) => !wanted.includes(rel));
  const manifestSame =
    existsSync(join(appImages, "manifest.json")) &&
    readFileSync(join(appImages, "manifest.json")).equals(readFileSync(join(dir, "manifest.json")));
  return { copy, keep, remove, manifestSame };
}

/** Runs the check and (unless `check`) the copy. Returns { ok, errors, warnings, plan }. */
export function syncImages({ dir, appImages = APP_IMAGES_DIR, repo = REPO_ROOT, check = false, log = console.log }) {
  const contract = readAppContract(repo);
  const result = checkImageSet(dir, contract);
  for (const w of result.warnings) log(`warning: ${w}`);
  for (const e of result.errors) log(`ERROR: ${e}`);
  if (result.errors.length) return { ok: false, errors: result.errors, warnings: result.warnings, plan: null };

  const plan = planSync(dir, appImages, result.manifest);
  log(
    `${plan.copy.length} to copy (${plan.copy.filter((c) => c.isNew).length} new), ${plan.keep.length} identical, ` +
      `${plan.remove.length} to remove, manifest ${plan.manifestSame ? "identical" : "changed"}; set is ${result.bytes} bytes`,
  );
  if (check) {
    for (const c of plan.copy) log(`  would copy   ${c.rel}${c.isNew ? " (new)" : ""}`);
    for (const rel of plan.remove) log(`  would remove ${rel}`);
    return { ok: true, errors: [], warnings: result.warnings, plan };
  }

  for (const { rel } of plan.copy) {
    mkdirSync(dirname(join(appImages, rel)), { recursive: true });
    copyFileSync(join(dir, rel), join(appImages, rel));
  }
  for (const rel of plan.remove) rmSync(join(appImages, rel));
  if (!plan.manifestSame) copyFileSync(join(dir, "manifest.json"), join(appImages, "manifest.json"));

  // the app's test also refuses a file the manifest does not name: re-check the folder as it stands now
  const after = checkImageSet(appImages, contract);
  const stray = presentInApp(appImages).filter((rel) => !manifestFiles(after.manifest ?? {}).includes(rel));
  const errors = [...after.errors, ...stray.map((s) => `stray file left in the app folder: ${s}`)];
  for (const e of errors) log(`ERROR after sync: ${e}`);
  return { ok: errors.length === 0, errors, warnings: result.warnings, plan };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (!existsSync(opts.dir) || !statSync(opts.dir).isDirectory()) throw new Error(`${opts.dir} is not a directory`);
    const { ok } = syncImages(opts);
    console.log(ok ? (opts.check ? "sync-images: check passed" : "sync-images: done") : "sync-images: FAILED");
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`sync-images: ${err.message}`);
    process.exit(2);
  }
}
