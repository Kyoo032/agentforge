#!/usr/bin/env node
/**
 * Release the Enterprise (hosted web app) to Kyoo032/DPSBuddy-Ent, its deploy-bundle + release repo.
 * Modelled on apps/desktop/scripts/release-desktop.mjs, which does the same for the Personal app on
 * Kyoo032/DPSBuddy. Run it after the deploy of <sha> is driven and logged in
 * docs/internal/web-pivot-2026-09-18.md (Deploy log).
 *
 *   node scripts/release-web.mjs --tag ent-2026.09.23 --sha <sha>
 *        [--dry-run] [--skip-image] [--draft] [--allow-dirty]
 *
 * In order:
 *   1. preflight: the tag is `ent-YYYY.MM.DD[.N]`, the tree is clean (unless --allow-dirty), <sha>
 *      resolves, docs/public/<tag>-notes.md exists and carries none of the five banned marks, and
 *      every file about to be published passes the same check;
 *   2. image: `git archive <sha>` into a temp dir, then from there
 *      `docker build -f webapp-deploy/Dockerfile -t ghcr.io/kyoo032/dpsbuddy-ent:<tag> .` and
 *      `docker push`. Building from the archive, never from this checkout, is what keeps untracked
 *      local state (a webdev data dir with its .master-key, an apps/web/.env.local) out of the image
 *      - the dockerignore only excludes `data` and `.env*` at the repo root;
 *   3. bundle: clone DPSBuddy-Ent into the same temp dir, write compose.yml (image pinned to the
 *      tag), .env.example, DEPLOY.md and Caddyfile, commit `Release <tag>` as the git user of this
 *      repo with no trailers, push `main`;
 *   4. release: `gh release create <tag>` with the notes + `Source: agentforge@<sha>` +
 *      `Image: <image>`, then `gh release view` to confirm.
 * The temp dir is removed on every exit path.
 *
 * `--dry-run` runs no docker, no gh, and no git beyond reading this repo (status, rev-parse, and
 * `show <sha>:webapp-deploy/Caddyfile`). `--skip-image` skips step 2 only (the image for this tag is
 * already pushed). This script never pushes agentforge.
 *
 * Rizky has not confirmed the tag scheme; ent-CalVer is the working default (AGENTS.md, Web release).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RELEASE_REPO = "Kyoo032/DPSBuddy-Ent";
export const RELEASE_REPO_URL = `https://github.com/${RELEASE_REPO}.git`;
export const SOURCE_REPO_NAME = "agentforge";
export const IMAGE_REPO = "ghcr.io/kyoo032/dpsbuddy-ent";
/** Words that must never reach the public repo. Matched case-insensitively as substrings. */
export const FORBIDDEN_MARKS = ["Claude", "Anthropic", "agent", "Co-Authored", "docs/internal"];
/**
 * What the hosted app refuses to boot without (packages/host/src/hosted-env.ts, hostedEnvProblems,
 * with NODE_ENV=production), plus DPSBUDDY_DOMAIN, which the Caddyfile serves.
 */
export const REQUIRED_ENV = [
  "DPSBUDDY_DOMAIN",
  "AGENTFORGE_SECRETS_KEY",
  "AGENTFORGE_TRUSTED_ORIGINS",
  "AGENTFORGE_PORTAL_URL",
  "AGENTFORGE_PORTAL_CLIENT_ID",
  "AGENTFORGE_PORTAL_CLIENT_SECRET",
  "AGENTFORGE_BILLING_WEBHOOK_SECRET",
];
export const BUNDLE_FILES = ["compose.yml", ".env.example", "DEPLOY.md", "Caddyfile"];

const TAG_PATTERN = /^ent-(\d{4})\.(\d{2})\.(\d{2})(?:\.([1-9]\d*))?$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;
const defaultRepoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export class ReleaseError extends Error {}

function fail(reason) {
  throw new ReleaseError(reason);
}

/** Returns null when the tag is valid, otherwise the reason it is not. */
export function tagProblem(tag) {
  const match = TAG_PATTERN.exec(tag ?? "");
  if (!match) return `tag "${tag}" is not ent-YYYY.MM.DD or ent-YYYY.MM.DD.N`;
  const [, year, month, day, sequence] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const real =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  if (!real) return `tag "${tag}" names a date that does not exist`;
  if (sequence !== undefined && Number(sequence) < 2) {
    return `tag "${tag}": the same-day suffix starts at .2 (the first release of a day has none)`;
  }
  return null;
}

/** The forbidden marks present in the notes text, in FORBIDDEN_MARKS order. */
export function forbiddenMarksIn(text) {
  const lower = text.toLowerCase();
  return FORBIDDEN_MARKS.filter((mark) => lower.includes(mark.toLowerCase()));
}

/**
 * The same check for a generated file. The one exception is the source repo's own name, which the
 * app's env names (AGENTFORGE_*), the image's /opt/agentforge path and the `Source:` line cannot
 * avoid. Every other "agent" is still refused, so "Agents" or "agent-written" fails.
 */
export function forbiddenMarksInPublished(text) {
  return forbiddenMarksIn(text.replace(/agentforge/gi, ""));
}

function assertPublishable(name, text) {
  const marks = forbiddenMarksInPublished(text);
  if (marks.length > 0) fail(`refusing to publish ${name}: it contains ${marks.map((m) => `"${m}"`).join(", ")}`);
}

export function imageRef(tag) {
  return `${IMAGE_REPO}:${tag}`;
}

export function releaseBody(notes, fullSha, image) {
  const imageLine = image ? `Image: ${image}\n` : "";
  return `${notes.trimEnd()}\n\nSource: ${SOURCE_REPO_NAME}@${fullSha}\n${imageLine}`;
}

// ---------- the bundle ----------

export function composeFile(tag) {
  return `# DPSBuddy Enterprise ${tag}. Run it with DEPLOY.md. Generated per release; do not edit here.
name: dpsbuddy-ent

services:
  app:
    image: ${imageRef(tag)}
    env_file:
      - path: .env
        required: true
    environment:
      NODE_ENV: production
      PORT: "3000"
      AGENTFORGE_SERVER: "1"
      AGENTFORGE_DATA_DIR: /data
      AGENTFORGE_COMPONENTS_DIR: /opt/agentforge/components
      TMPDIR: /tmp
      XDG_CACHE_HOME: /tmp/.cache
      NPM_CONFIG_CACHE: /tmp/.npm
      AGENTFORGE_SECRETS_KEY: \${AGENTFORGE_SECRETS_KEY:-}
    read_only: true
    tmpfs:
      - /tmp:mode=1777,size=512m,nosuid,nodev,noexec
    volumes:
      - dpsbuddy-data:/data
      - dpsbuddy-components:/opt/agentforge/components
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    init: true
    pids_limit: 512
    mem_limit: 6g
    mem_reservation: 1g
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    # The app binds loopback; the proxy shares this network namespace, so the ports live here.
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    restart: unless-stopped

  proxy:
    image: caddy:2-alpine
    network_mode: "service:app"
    depends_on:
      - app
    env_file:
      - path: .env
        required: true
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    read_only: true
    tmpfs:
      - /tmp:mode=1777,size=64m,nosuid,nodev,noexec
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    init: true
    pids_limit: 128
    mem_limit: 512m
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    restart: unless-stopped

volumes:
  dpsbuddy-data:
  dpsbuddy-components:
  caddy-data:
  caddy-config:
`;
}

export function envExample() {
  return `# DPSBuddy Enterprise: every variable the hosted app refuses to start without.
# Copy to .env next to compose.yml and fill each one in. Never commit .env.

# Public hostname. The proxy serves it and obtains its TLS certificate.
DPSBUDDY_DOMAIN=
# 32-byte hex wrap key for stored secrets (openssl rand -hex 32). Generate once and keep it.
AGENTFORGE_SECRETS_KEY=
# The public origin with its scheme, https://<DPSBUDDY_DOMAIN>. Comma-separated for more than one.
AGENTFORGE_TRUSTED_ORIGINS=
# Portal base URL (https) and this app's confidential client at that portal.
AGENTFORGE_PORTAL_URL=
AGENTFORGE_PORTAL_CLIENT_ID=
AGENTFORGE_PORTAL_CLIENT_SECRET=
# Shared secret the payment provider sends on the billing webhook (openssl rand -hex 32).
AGENTFORGE_BILLING_WEBHOOK_SECRET=
`;
}

export function deployDoc(tag) {
  return `# Deploy DPSBuddy Enterprise ${tag}

This folder runs one release of the hosted app: the image \`${imageRef(tag)}\`, a Caddy proxy in
front of it, and volumes for its data. Nothing is built on the server.

1. \`docker login ghcr.io\` with a GitHub token that can read packages. The image is private.
2. \`cp .env.example .env\`, fill in every name, and keep \`.env\` off git. Generate
   \`AGENTFORGE_SECRETS_KEY\` once and keep it: a new key cannot read the old data.
3. Point the DNS record for \`DPSBUDDY_DOMAIN\` at this server and open ports 80 and 443.
4. \`docker compose pull && docker compose up -d\`
5. \`docker compose ps\` until \`app\` is \`healthy\`, then open \`https://<DPSBUDDY_DOMAIN>\`.

Back up the \`dpsbuddy-data\` volume before an upgrade: the database migrates forward only. To roll
back, check out the previous release tag of this repo and repeat steps 4 and 5.
`;
}

/** webapp-deploy/Caddyfile at <sha>, with its comment lines dropped (they cite source paths). */
export function caddyfileFrom(source, tag) {
  const directives = source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `# DPSBuddy Enterprise ${tag}. Generated per release; do not edit here.\n${directives}\n`;
}

export function renderBundle(tag, caddySource) {
  return {
    "compose.yml": composeFile(tag),
    ".env.example": envExample(),
    "DEPLOY.md": deployDoc(tag),
    Caddyfile: caddyfileFrom(caddySource, tag),
  };
}

// ---------- arguments ----------

export function ghReleaseArgs(tag, notesFile, flags) {
  return [
    "release",
    "create",
    tag,
    "--repo",
    RELEASE_REPO,
    "--title",
    tag,
    "--notes-file",
    notesFile,
    ...(flags.draft ? ["--draft"] : []),
  ];
}

export function dockerArgs(image) {
  return { build: ["build", "-f", "webapp-deploy/Dockerfile", "-t", image, "."], push: ["push", image] };
}

export function parseArgs(argv) {
  const defaults = { tag: null, sha: null, dryRun: false, draft: false, allowDirty: false, skipImage: false };
  const valueFlags = { "--tag": "tag", "--sha": "sha" };
  const boolFlags = {
    "--dry-run": "dryRun",
    "--draft": "draft",
    "--allow-dirty": "allowDirty",
    "--skip-image": "skipImage",
  };
  const pairs = argv.flatMap((arg, i) => {
    if (boolFlags[arg]) return [[boolFlags[arg], true]];
    if (valueFlags[arg]) {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) fail(`${arg} needs a value`);
      return [[valueFlags[arg], argv[i + 1]]];
    }
    if (argv[i - 1] in valueFlags) return [];
    return fail(`unknown argument ${arg}`);
  });
  const flags = { ...defaults, ...Object.fromEntries(pairs) };
  if (!flags.tag) fail("--tag is required (ent-YYYY.MM.DD)");
  if (!flags.sha) fail("--sha is required (the agentforge commit that is deployed)");
  return flags;
}

// ---------- side effects, all through deps ----------

function ghBin() {
  return process.platform === "win32" ? "gh.exe" : "gh";
}

/** Windows' own bsdtar: Git Bash's GNU tar reads `C:\...` as a remote host. */
function tarBin() {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

const defaultDeps = {
  repoRoot: defaultRepoRoot,
  git: (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" }),
  docker: (args, cwd) => spawnSync("docker", args, { cwd, stdio: "inherit" }),
  tar: (args, cwd) => spawnSync(tarBin(), args, { cwd, encoding: "utf8" }),
  gh: (args, cwd) => spawnSync(ghBin(), args, { cwd, stdio: "inherit" }),
  ghView: (tag) =>
    spawnSync(ghBin(), ["release", "view", tag, "--repo", RELEASE_REPO, "--json", "tagName"], { encoding: "utf8" }),
  log: (line) => console.log(`web-release: ${line}`),
};

function expectOk(result, what) {
  if (result.error) fail(`could not start ${what}: ${result.error.message}`);
  if (result.status !== 0) fail(`${what} exited ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  return result;
}

function checkGitClean(flags, deps) {
  const status = deps.git(["status", "--porcelain"], deps.repoRoot);
  if (status.status !== 0) fail("git status failed");
  const dirty = status.stdout.trim().length > 0;
  if (dirty && !flags.allowDirty) fail("working tree is dirty (use --allow-dirty)");
  deps.log(`ok - ${dirty ? "dirty tree allowed (the image and bundle still come from <sha>)" : "working tree clean"}`);
}

function resolveSha(sha, deps) {
  if (!SHA_PATTERN.test(sha)) fail(`--sha "${sha}" is not a hex commit id`);
  const parsed = deps.git(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], deps.repoRoot);
  const full = parsed.status === 0 ? parsed.stdout.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(full)) fail(`commit ${sha} does not exist in this repo`);
  deps.log(`ok - commit ${full}`);
  return full;
}

function readNotes(tag, deps) {
  const file = join(deps.repoRoot, "docs", "public", `${tag}-notes.md`);
  if (!existsSync(file)) fail(`notes file not found: docs/public/${tag}-notes.md`);
  const notes = readFileSync(file, "utf8");
  if (notes.trim().length === 0) fail(`notes file is empty: docs/public/${tag}-notes.md`);
  const marks = forbiddenMarksIn(notes);
  if (marks.length > 0) {
    fail(`refusing docs/public/${tag}-notes.md: it contains ${marks.map((m) => `"${m}"`).join(", ")}`);
  }
  deps.log(`ok - notes docs/public/${tag}-notes.md`);
  return notes;
}

function readCaddyfile(fullSha, deps) {
  const shown = deps.git(["show", `${fullSha}:webapp-deploy/Caddyfile`], deps.repoRoot);
  if (shown.status !== 0 || !shown.stdout?.trim()) fail(`webapp-deploy/Caddyfile not found at ${fullSha}`);
  return shown.stdout;
}

function buildAndPushImage(fullSha, image, workDir, deps) {
  const contextTar = join(workDir, "context.tar");
  const contextDir = join(workDir, "context");
  expectOk(
    deps.git(["-c", "core.autocrlf=false", "archive", "--format=tar", "--output", contextTar, fullSha], deps.repoRoot),
    "git archive",
  );
  mkdirSync(contextDir);
  expectOk(deps.tar(["-xf", contextTar, "-C", contextDir], workDir), "tar");
  deps.log(`ok - build context = git archive ${fullSha}`);
  const args = dockerArgs(image);
  expectOk(deps.docker(args.build, contextDir), "docker build");
  expectOk(deps.docker(args.push, contextDir), "docker push");
  deps.log(`ok - pushed ${image}`);
}

function gitIdentity(deps) {
  const read = (key) => deps.git(["config", key], deps.repoRoot).stdout?.trim() ?? "";
  const name = read("user.name");
  const email = read("user.email");
  if (!name || !email) fail("git user.name / user.email are not set for this repo");
  return ["-c", `user.name=${name}`, "-c", `user.email=${email}`];
}

function assertTreePublishable(cloneDir) {
  for (const entry of readdirSync(cloneDir, { recursive: true, withFileTypes: true })) {
    const rel = relative(cloneDir, join(entry.parentPath ?? entry.path, entry.name));
    if (!entry.isFile() || rel.split(sep)[0] === ".git") continue;
    assertPublishable(rel, readFileSync(join(cloneDir, rel), "utf8"));
  }
}

function pushBundle(tag, bundle, workDir, deps) {
  const cloneDir = join(workDir, "DPSBuddy-Ent");
  if (resolve(cloneDir) === resolve(deps.repoRoot)) fail("refusing to push from the source repo");
  const identity = gitIdentity(deps);
  expectOk(
    deps.git(["clone", "--quiet", "--depth", "1", "--branch", "main", RELEASE_REPO_URL, cloneDir], workDir),
    "git clone",
  );
  for (const [name, content] of Object.entries(bundle)) writeFileSync(join(cloneDir, name), content, "utf8");
  assertTreePublishable(cloneDir);
  expectOk(deps.git(["add", "--", ...Object.keys(bundle)], cloneDir), "git add");
  const changed = expectOk(deps.git(["status", "--porcelain"], cloneDir), "git status").stdout.trim();
  if (!changed) {
    deps.log(`ok - bundle already matches ${RELEASE_REPO} main, nothing to commit`);
    return;
  }
  expectOk(deps.git([...identity, "commit", "--quiet", "-m", `Release ${tag}`], cloneDir), "git commit");
  expectOk(deps.git(["push", "--quiet", "origin", "HEAD:main"], cloneDir), "git push");
  deps.log(`ok - pushed bundle to ${RELEASE_REPO} main`);
}

function publish(args, tag, deps) {
  const run = deps.gh(args, deps.repoRoot);
  if (run.error) fail(`could not start gh: ${run.error.message}`);
  if (run.status !== 0) fail(`gh release create exited ${run.status}`);
  const view = deps.ghView(tag);
  if (view.status !== 0) fail(`release ${tag} not visible on ${RELEASE_REPO} after create`);
  deps.log(`ok - published ${tag} to ${RELEASE_REPO}`);
}

function quoteArgs(args) {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

function logPlan(flags, image, ghArgs, bundle, deps) {
  const docker = dockerArgs(image);
  if (flags.skipImage) {
    deps.log(`skip - image (--skip-image): ${image} must already be pushed`);
  } else {
    deps.log(`plan - git archive <sha> into a temp dir, then docker ${quoteArgs(docker.build)}`);
    deps.log(`plan - docker ${quoteArgs(docker.push)}`);
  }
  deps.log(`plan - clone ${RELEASE_REPO} into a temp dir, write ${Object.keys(bundle).join(", ")}`);
  for (const [name, content] of Object.entries(bundle))
    deps.log(`       ${name} (${Buffer.byteLength(content)} bytes)`);
  deps.log(`plan - commit "Release ${flags.tag}" (no trailers), push main, delete the temp dir`);
  deps.log(`gh ${quoteArgs(ghArgs)}`);
}

/**
 * Returns what it ran (or would run). Throws ReleaseError on refusal. `deps` is injectable so the
 * tests can drive every path against a fake repo root, a fake git, docker, tar and gh.
 */
export function main(argv = process.argv.slice(2), overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  const flags = parseArgs(argv);
  const problem = tagProblem(flags.tag);
  if (problem) fail(problem);
  const image = imageRef(flags.tag);
  deps.log(`ok - target ${RELEASE_REPO} ${flags.tag}, image ${image}`);
  checkGitClean(flags, deps);
  const fullSha = resolveSha(flags.sha, deps);
  const body = releaseBody(readNotes(flags.tag, deps), fullSha, image);
  assertPublishable("the release body", body);
  const bundle = renderBundle(flags.tag, readCaddyfile(fullSha, deps));
  for (const [name, content] of Object.entries(bundle)) assertPublishable(name, content);
  deps.log(`ok - bundle has none of the banned marks`);
  const workDir = mkdtempSync(join(tmpdir(), "dpsbuddy-ent-release-"));
  try {
    const bodyFile = join(workDir, `${flags.tag}-body.md`);
    writeFileSync(bodyFile, body, "utf8");
    const args = ghReleaseArgs(flags.tag, bodyFile, flags);
    logPlan(flags, image, args, bundle, deps);
    if (flags.dryRun) {
      deps.log(`dry run, nothing published. Body:\n${body}`);
      return { args, body, bundle, image, workDir, published: false };
    }
    if (!flags.skipImage) buildAndPushImage(fullSha, image, workDir, deps);
    pushBundle(flags.tag, bundle, workDir, deps);
    publish(args, flags.tag, deps);
    return { args, body, bundle, image, workDir, published: true };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    console.error(`web-release: ${error.message}`);
    process.exit(1);
  }
}
