#!/usr/bin/env node
/**
 * Publish the packed Agentforge Setup exe, its blockmap and latest.yml to the public
 * releases repo named in branding/agentforge/brand.json "updates". Run after
 * `pnpm desktop:build`. Uploaded asset names are hyphenated (what electron-updater's
 * GitHub provider requests); the local files keep the spaced artifactName.
 *
 * macOS artifacts (`Agentforge-<version>-mac-<arch>.dmg|zip`, built on a Mac with
 * `pnpm desktop:build:mac` and copied into dist/) are attached to the same release when
 * present. `latest-mac.yml` and mac blockmaps are never uploaded: the mac app is unsigned
 * and its updater is off. `--require-mac` fails when either arch is missing.
 *
 * `--attach-mac` is the follow-up mode: the Windows release v<version> already exists, and
 * the mac dmg/zip (downloaded from the desktop-mac workflow into dist/) are uploaded to it
 * with `gh release upload`, then the release notes are refreshed from the public notes file.
 * No exe, blockmap or latest.yml is touched.
 *
 *   node scripts/release-desktop.mjs [--dry-run] [--draft] [--allow-dirty] [--allow-stale]
 *                                    [--require-mac] [--attach-mac] [--dist <dir>] [--notes <file>]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeMacCoverage, selectMacArtifacts } from "./release-artifacts.mjs";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopRoot, "..", "..");
const ARTIFACT_PREFIX = "Agentforge Setup";
const SETUP_EXE = /Setup.*\.exe$/i;

function fail(reason) {
  console.error(`desktop-release: ${reason}`);
  process.exit(1);
}

function ok(message) {
  console.log(`desktop-release: ok - ${message}`);
}

function parseArgs(argv) {
  const defaults = {
    dryRun: false,
    draft: false,
    allowDirty: false,
    allowStale: false,
    requireMac: false,
    attachMac: false,
    dist: "dist",
    notes: null,
  };
  const valueFlags = { "--dist": "dist", "--notes": "notes" };
  const boolFlags = {
    "--dry-run": "dryRun",
    "--draft": "draft",
    "--allow-dirty": "allowDirty",
    "--allow-stale": "allowStale",
    "--require-mac": "requireMac",
    "--attach-mac": "attachMac",
  };
  const pairs = argv.flatMap((arg, i) => {
    if (boolFlags[arg]) return [[boolFlags[arg], true]];
    if (valueFlags[arg]) {
      if (!argv[i + 1]) fail(`${arg} needs a value`);
      return [[valueFlags[arg], argv[i + 1]]];
    }
    if (argv[i - 1] in valueFlags) return [];
    return fail(`unknown argument ${arg}`);
  });
  return { ...defaults, ...Object.fromEntries(pairs) };
}

function readTarget() {
  const pkg = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
  const brand = JSON.parse(readFileSync(join(desktopRoot, "branding", "agentforge", "brand.json"), "utf8"));
  const version = typeof pkg.version === "string" ? pkg.version.trim() : "";
  if (!/^\d+\.\d+\.\d+/.test(version)) fail("package.json version is not semver");
  const extraVersion = pkg.build?.extraMetadata?.version;
  if (extraVersion !== undefined && extraVersion !== version) {
    fail(`build.extraMetadata.version ${extraVersion} disagrees with version ${version}`);
  }
  const updates = brand.updates ?? {};
  if (updates.provider !== "github" || !updates.owner || !updates.repo) {
    fail('brand.json "updates" must be { provider: "github", owner, repo }');
  }
  const publish = pkg.build?.publish ?? {};
  if (publish.owner !== updates.owner || publish.repo !== updates.repo) {
    fail("package.json build.publish and brand.json updates name different repos");
  }
  return { version, owner: updates.owner, repo: updates.repo };
}

/** Minimal line parser for electron-builder's latest.yml (top-level keys + files[]). */
function parseLatestYml(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => /^(\s*)(- )?(\w+):\s*(.*)$/.exec(line))
    .filter(Boolean)
    .map(([, indent, dash, key, value]) => ({ nested: indent.length > 0, starts: Boolean(dash), key, value: value.trim() }));
  const top = Object.fromEntries(rows.filter((row) => !row.nested).map((row) => [row.key, row.value]));
  // Each "- " row starts a new files[] entry; following nested rows belong to it.
  const groups = rows.filter((row) => row.nested).reduce((acc, row) => {
    if (row.starts) acc.push([]);
    if (acc.length > 0) acc[acc.length - 1].push([row.key, row.value]);
    return acc;
  }, []);
  return { ...top, files: groups.map((entries) => Object.fromEntries(entries)) };
}

function sha512Base64(file) {
  return createHash("sha512").update(readFileSync(file)).digest("base64");
}

function hyphenate(name) {
  return name.replace(/ /g, "-");
}

function checkGitClean(flags) {
  const git = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  if (git.status !== 0) fail("git status failed");
  if (git.stdout.trim() && !flags.allowDirty) fail("working tree is dirty (use --allow-dirty)");
  ok(git.stdout.trim() ? "dirty tree allowed" : "working tree clean");
}

function checkDist(distDir, version, flags) {
  if (!existsSync(distDir)) fail(`missing ${distDir}`);
  const setups = readdirSync(distDir).filter((n) => SETUP_EXE.test(n));
  if (setups.length > 1 && !flags.allowStale) {
    fail(`${distDir} holds ${setups.length} Setup exes; clean stale builds or pass --allow-stale`);
  }
  const exeName = `${ARTIFACT_PREFIX} ${version}.exe`;
  const exe = join(distDir, exeName);
  const blockmap = `${exe}.blockmap`;
  const latest = join(distDir, "latest.yml");
  for (const f of [exe, blockmap, latest]) if (!existsSync(f)) fail(`missing ${f}`);
  ok(`found ${exeName}, blockmap, latest.yml (${setups.length} Setup exe(s) in dist)`);
  const mac = checkMacArtifacts(distDir, version, flags);
  return { exeName, exe, blockmap, latest, macNames: mac.uploads, mac: mac.uploads.map((name) => join(distDir, name)) };
}

/** Mac dmg/zip for this version ride along with the Windows assets; feeds and stale builds do not. */
function checkMacArtifacts(distDir, version, flags) {
  const selection = selectMacArtifacts(readdirSync(distDir), version);
  if (selection.stale.length > 0 && !flags.allowStale) {
    fail(`${distDir} holds mac artifacts from another version (${selection.stale.join(", ")}); clean them or pass --allow-stale`);
  }
  if (selection.forbidden.length > 0) {
    ok(`${selection.forbidden.join(", ")} present but never uploaded (mac updater is off)`);
  }
  if (flags.requireMac && selection.missingArches.length > 0) {
    fail(`--require-mac: missing mac artifacts for ${selection.missingArches.join(", ")} (expected Agentforge-${version}-mac-<arch>.dmg)`);
  }
  ok(describeMacCoverage(selection));
  return selection;
}

function checkLatest(files, version) {
  const info = parseLatestYml(readFileSync(files.latest, "utf8"));
  const entry = info.files[0];
  if (!entry) fail("latest.yml has no files[] entry");
  if (info.version !== version) fail(`latest.yml version ${info.version} != package version ${version}`);
  ok(`latest.yml version ${info.version}`);
  const size = statSync(files.exe).size;
  if (String(size) !== entry.size) fail(`exe size ${size} != latest.yml size ${entry.size}`);
  ok(`size ${size}`);
  const digest = sha512Base64(files.exe);
  if (digest !== entry.sha512 || digest !== info.sha512) fail("exe sha512 does not match latest.yml");
  ok("sha512 matches");
  const expectedUrl = hyphenate(files.exeName);
  if (entry.url !== expectedUrl) fail(`latest.yml url ${entry.url} != ${expectedUrl}`);
  if (info.path !== expectedUrl) fail(`latest.yml path "${info.path}" != ${expectedUrl} (stale rewrite?)`);
  ok(`url + path ${expectedUrl}`);
}

function notesArgs(version, flags) {
  // Public-repo notes only. docs/internal/ is never a default: those changelogs hold
  // operator and process detail that must not be published.
  if (flags.notes) {
    if (join(flags.notes).includes(join("docs", "internal"))) fail("refusing to publish docs/internal notes to the public repo");
    if (!existsSync(flags.notes)) fail(`notes file not found: ${flags.notes}`);
    return ["--notes-file", flags.notes];
  }
  const publicNotes = join(repoRoot, "docs", "public", `${version}-notes.md`);
  if (existsSync(publicNotes)) return ["--notes-file", publicNotes];
  return ["--notes", `Agentforge ${version}`];
}

/**
 * GitHub derives the asset name from the uploaded file's basename (gh's `#` suffix only sets the
 * display label, and spaces become dots server-side), so stage copies under the hyphenated names
 * electron-updater requests and upload those.
 */
function stageUploads(files) {
  const stageDir = mkdtempSync(join(tmpdir(), "agentforge-release-"));
  const exeName = hyphenate(files.exeName);
  const uploads = [
    [files.exe, exeName],
    [files.blockmap, `${exeName}.blockmap`],
    [files.latest, "latest.yml"],
    // Mac names are already hyphenated by mac.artifactName; they upload as-is.
    ...files.mac.map((source, i) => [source, files.macNames[i]]),
  ].map(([source, name]) => {
    const staged = join(stageDir, name);
    copyFileSync(source, staged);
    return staged;
  });
  return { stageDir, uploads };
}

function ghArgs(target, uploads, flags) {
  const { version, owner, repo } = target;
  return [
    "release", "create", `v${version}`, "--repo", `${owner}/${repo}`, "--title", `v${version}`,
    ...notesArgs(version, flags), ...(flags.draft ? ["--draft"] : []), ...uploads,
  ];
}

function verifyAssetNames(target, exeName, macNames) {
  const expected = [hyphenate(exeName), `${hyphenate(exeName)}.blockmap`, "latest.yml", ...macNames];
  const names = releaseAssetNames(target).sort();
  if (names.join(",") !== [...expected].sort().join(",")) {
    fail(`uploaded asset names [${names.join(", ")}] do not match the expected set [${expected.join(", ")}]`);
  }
  ok(`uploaded asset names match (${expected.length} assets)`);
}

function ghBin() {
  return process.platform === "win32" ? "gh.exe" : "gh";
}

function releaseAssetNames(target) {
  const view = spawnSync(
    ghBin(),
    ["api", `repos/${target.owner}/${target.repo}/releases/tags/v${target.version}`, "-q", ".assets[].name"],
    { encoding: "utf8" },
  );
  if (view.status !== 0) fail(`release v${target.version} not found on ${target.owner}/${target.repo}`);
  return view.stdout.split(/\r?\n/).filter(Boolean);
}

/** Attach mac dmg/zip from dist/ to the already-published Windows release and refresh its notes. */
function attachMac(target, flags) {
  const distDir = resolve(desktopRoot, flags.dist);
  if (!existsSync(distDir)) fail(`missing ${distDir}`);
  const selection = checkMacArtifacts(distDir, target.version, { ...flags, requireMac: true });
  const existing = releaseAssetNames(target);
  ok(`release v${target.version} exists with ${existing.length} asset(s)`);
  const clashes = selection.uploads.filter((name) => existing.includes(name));
  if (clashes.length > 0) fail(`already on the release: ${clashes.join(", ")} (delete them first to replace)`);
  const uploads = selection.uploads.map((name) => join(distDir, name));
  const uploadArgs = ["release", "upload", `v${target.version}`, "--repo", `${target.owner}/${target.repo}`, ...uploads];
  const notes = notesArgs(target.version, flags);
  const editArgs = ["release", "edit", `v${target.version}`, "--repo", `${target.owner}/${target.repo}`, ...notes];
  console.log(`desktop-release: gh ${uploadArgs.join(" ")}`);
  console.log(`desktop-release: gh ${editArgs.join(" ")}`);
  if (flags.dryRun) return console.log("desktop-release: dry run, nothing uploaded");
  for (const args of [uploadArgs, editArgs]) {
    const gh = spawnSync(ghBin(), args, { cwd: desktopRoot, stdio: "inherit" });
    if (gh.error) fail(`could not start gh: ${gh.error.message}`);
    if (gh.status !== 0) fail(`gh ${args[0]} ${args[1]} exited ${gh.status}`);
  }
  const after = releaseAssetNames(target);
  const missing = selection.uploads.filter((name) => !after.includes(name));
  if (missing.length > 0) fail(`assets not visible after upload: ${missing.join(", ")}`);
  ok(`attached ${selection.uploads.length} mac asset(s) to v${target.version}; release now has ${after.length} assets`);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const target = readTarget();
  ok(`target ${target.owner}/${target.repo} v${target.version}`);
  checkGitClean(flags);
  if (flags.attachMac) return attachMac(target, flags);
  const files = checkDist(resolve(desktopRoot, flags.dist), target.version, flags);
  checkLatest(files, target.version);
  const { stageDir, uploads } = stageUploads(files);
  try {
    const args = ghArgs(target, uploads, flags);
    const shown = args.map((a) => (/\s|#/.test(a) ? `"${a}"` : a)).join(" ");
    console.log(`desktop-release: gh ${shown}`);
    if (flags.dryRun) return console.log("desktop-release: dry run, nothing uploaded");
    const gh = spawnSync(ghBin(), args, { cwd: desktopRoot, stdio: "inherit" });
    if (gh.error) fail(`could not start gh: ${gh.error.message}`);
    if (gh.status !== 0) fail(`gh release create exited ${gh.status}`);
    verifyAssetNames(target, files.exeName, files.macNames);
    ok(`published v${target.version} to ${target.owner}/${target.repo}`);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

main();
