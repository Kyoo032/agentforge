/**
 * Tests for scripts/release-web.mjs, the Enterprise release to Kyoo032/DPSBuddy-Ent.
 *
 * Node's own runner, like scripts/review-proxy.test.mjs: repo tooling outside every workspace
 * package, so no vitest config collects it. `node --test "scripts/*.test.mjs"` runs it.
 *
 * Nothing here calls gh, git, docker or the network. Every case drives `main` against a temp repo
 * root, a fake git (which "clones" by making a directory), and recording docker / tar / gh stubs.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  BUNDLE_FILES,
  FORBIDDEN_MARKS,
  forbiddenMarksIn,
  forbiddenMarksInPublished,
  ghReleaseArgs,
  IMAGE_REPO,
  main,
  parseArgs,
  RELEASE_REPO,
  RELEASE_REPO_URL,
  REQUIRED_ENV,
  ReleaseError,
  releaseBody,
  renderBundle,
  tagProblem,
} from "./release-web.mjs";

const FULL_SHA = "0b73a68aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TAG = "ent-2026.09.23";
const CLEAN_NOTES = "# DPSBuddy Enterprise, 23 September 2026\n\n- The warm desk is live.\n";
const IMAGE = `ghcr.io/kyoo032/dpsbuddy-ent:${TAG}`;
const CADDY_SOURCE =
  "# see packages/host/src/http-adapter.ts\n{\n\tadmin off\n}\n\n\n\n{$DPSBUDDY_DOMAIN} {\n\t# comment\n\treverse_proxy 127.0.0.1:3000\n}\n";
const README = "# DPSBuddy Enterprise\n";
/** The git a dry run may run: reads of this repo only. */
const READ_ONLY_GIT = new Set(["status", "rev-parse", "show"]);

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fakeRepo(notesByTag) {
  const root = mkdtempSync(join(tmpdir(), "release-web-test-"));
  roots.push(root);
  mkdirSync(join(root, "docs", "public"), { recursive: true });
  for (const [tag, text] of Object.entries(notesByTag)) {
    writeFileSync(join(root, "docs", "public", `${tag}-notes.md`), text, "utf8");
  }
  return root;
}

/** The git subcommand, skipping leading `-c key=value` pairs. */
function subcommand(args) {
  let i = 0;
  while (args[i] === "-c") i += 2;
  return args[i];
}

function snapshot(dir) {
  const names = readdirSync(dir).filter((name) => name !== ".git");
  return Object.fromEntries(names.map((name) => [name, readFileSync(join(dir, name), "utf8")]));
}

/**
 * A fake git. Every call lands in `calls` with its cwd. `clone` makes the target directory with a
 * README, as DPSBuddy-Ent's main has; `commit` snapshots the files in the clone at that moment.
 */
function fakeGit({ dirty = false, known = [FULL_SHA], calls = [], commits = [], cloneReadme = README } = {}) {
  const handlers = {
    status: (_args, cwd) => {
      if (cwd.endsWith("DPSBuddy-Ent")) return { status: 0, stdout: "A  compose.yml\n" };
      return { status: 0, stdout: dirty ? " M AGENTS.md\n" : "" };
    },
    "rev-parse": (args) => {
      const wanted = args.at(-1).replace("^{commit}", "");
      const hit = known.find((sha) => sha.startsWith(wanted));
      return hit ? { status: 0, stdout: `${hit}\n` } : { status: 1, stdout: "" };
    },
    show: () => ({ status: 0, stdout: CADDY_SOURCE }),
    config: (args) => ({ status: 0, stdout: args.at(-1) === "user.name" ? "rizky\n" : "rizky@example.com\n" }),
    clone: (args) => {
      const dir = args.at(-1);
      mkdirSync(join(dir, ".git"), { recursive: true });
      writeFileSync(join(dir, "README.md"), cloneReadme, "utf8");
      return { status: 0 };
    },
    commit: (args, cwd) => {
      commits.push({ args, cwd, files: snapshot(cwd) });
      return { status: 0 };
    },
    archive: () => ({ status: 0 }),
    add: () => ({ status: 0 }),
    push: () => ({ status: 0 }),
  };
  return (args, cwd) => {
    const sub = subcommand(args);
    calls.push({ args, cwd, sub });
    if (!handlers[sub]) throw new Error(`unexpected git ${args.join(" ")}`);
    return handlers[sub](args, cwd);
  };
}

const neverGh = () => assert.fail("gh must not run in a dry run");

function deps(root, gitOptions = {}) {
  const lines = [];
  const gitCalls = [];
  const commits = [];
  const dockerCalls = [];
  const tarCalls = [];
  const record = (list) => (args, cwd) => {
    list.push({ args, cwd });
    return { status: 0 };
  };
  return {
    repoRoot: root,
    git: fakeGit({ ...gitOptions, calls: gitCalls, commits }),
    docker: record(dockerCalls),
    tar: record(tarCalls),
    gh: neverGh,
    ghView: neverGh,
    log: (l) => lines.push(l),
    lines,
    gitCalls,
    commits,
    dockerCalls,
    tarCalls,
  };
}

function recordingGh() {
  const calls = [];
  return {
    calls,
    gh: (args) => {
      calls.push(args);
      return { status: 0 };
    },
    ghView: (tag) => {
      calls.push(["view", tag]);
      return { status: 0 };
    },
  };
}

// ---------- tag format ----------

test("accepts ent-YYYY.MM.DD and a same-day suffix from .2", () => {
  for (const tag of ["ent-2026.09.23", "ent-2026.09.23.2", "ent-2026.12.31.10", "ent-2028.02.29"]) {
    assert.equal(tagProblem(tag), null, tag);
  }
});

test("refuses malformed tags, impossible dates, and .0 / .1 suffixes", () => {
  const bad = [
    "v0.15.0",
    "2026.09.23",
    "ent-2026.9.23",
    "ent-2026-09-23",
    "ent-2026.09.23.",
    "ent-2026.09.23.01",
    "ENT-2026.09.23",
    "ent-2026.09.23 ",
    "ent-2026.13.01",
    "ent-2026.02.30",
    "ent-2027.02.29",
    "ent-2026.09.23.0",
    "ent-2026.09.23.1",
    "",
    undefined,
  ];
  for (const tag of bad) assert.notEqual(tagProblem(tag), null, String(tag));
});

// ---------- notes refusal list ----------

test("the refusal list is exactly the five marks", () => {
  assert.deepEqual(FORBIDDEN_MARKS, ["Claude", "Anthropic", "agent", "Co-Authored", "docs/internal"]);
});

test("each mark is caught case-insensitively, including inside a longer word", () => {
  const cases = [
    ["Written with claude.", ["Claude"]],
    ["ANTHROPIC", ["Anthropic"]],
    ["Custom Agents are parked.", ["agent"]],
    ["See agentforge@abc", ["agent"]],
    ["co-authored-by: someone", ["Co-Authored"]],
    ["details in DOCS/INTERNAL/unreleased.md", ["docs/internal"]],
  ];
  for (const [text, expected] of cases) assert.deepEqual(forbiddenMarksIn(text), expected, text);
  assert.deepEqual(forbiddenMarksIn(CLEAN_NOTES), []);
});

test("main refuses a notes file that carries a mark, and names the marks", () => {
  const root = fakeRepo({ [TAG]: "# Notes\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n" });
  assert.throws(
    () => main(["--tag", TAG, "--sha", FULL_SHA, "--dry-run"], deps(root)),
    (error) => error instanceof ReleaseError && /"Claude", "Anthropic", "Co-Authored"/.test(error.message),
  );
});

test("main refuses a missing or empty notes file", () => {
  const missing = fakeRepo({});
  assert.throws(() => main(["--tag", TAG, "--sha", FULL_SHA, "--dry-run"], deps(missing)), /notes file not found/);
  const empty = fakeRepo({ [TAG]: "  \n" });
  assert.throws(() => main(["--tag", TAG, "--sha", FULL_SHA, "--dry-run"], deps(empty)), /notes file is empty/);
});

// ---------- rails before the notes ----------

test("main refuses a dirty tree unless --allow-dirty, and an unknown sha", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  assert.throws(
    () => main(["--tag", TAG, "--sha", FULL_SHA, "--dry-run"], deps(root, { dirty: true })),
    /working tree is dirty/,
  );
  assert.doesNotThrow(() =>
    main(["--tag", TAG, "--sha", FULL_SHA, "--dry-run", "--allow-dirty"], deps(root, { dirty: true })),
  );
  assert.throws(
    () => main(["--tag", TAG, "--sha", "deadbeef", "--dry-run"], deps(root)),
    /does not exist in this repo/,
  );
  assert.throws(() => main(["--tag", TAG, "--sha", "HEAD~1", "--dry-run"], deps(root)), /not a hex commit id/);
});

test("parseArgs requires --tag and --sha and rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--sha", FULL_SHA]), /--tag is required/);
  assert.throws(() => parseArgs(["--tag", TAG]), /--sha is required/);
  assert.throws(() => parseArgs(["--tag", "--sha", FULL_SHA]), /--tag needs a value/);
  assert.throws(() => parseArgs(["--tag", TAG, "--sha", FULL_SHA, "--push"]), /unknown argument --push/);
});

// ---------- dry run ----------

test("dry run builds the gh argv and the body, and never runs gh", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  const d = deps(root);
  const result = main(["--tag", TAG, "--sha", FULL_SHA.slice(0, 7), "--dry-run"], d);
  assert.equal(result.published, false);
  assert.deepEqual(result.args.slice(0, 8), [
    "release",
    "create",
    TAG,
    "--repo",
    RELEASE_REPO,
    "--title",
    TAG,
    "--notes-file",
  ]);
  assert.equal(result.args.length, 9, "no assets, no --draft, nothing after the notes file");
  assert.match(result.args[8], new RegExp(`${TAG}-body\\.md$`));
  assert.equal(RELEASE_REPO, "Kyoo032/DPSBuddy-Ent");
  assert.equal(
    result.body,
    `${CLEAN_NOTES.trimEnd()}\n\nSource: agentforge@${FULL_SHA}\nImage: ${IMAGE}\n`,
    "full sha, not the short one, then the image",
  );
  assert.ok(!result.args.includes("push"), "never a push");
  assert.ok(d.lines.some((line) => line.startsWith(`gh release create ${TAG} --repo ${RELEASE_REPO}`)));
  assert.ok(d.lines.some((line) => line.startsWith("dry run, nothing published")));
});

test("--draft is passed through to gh", () => {
  assert.deepEqual(ghReleaseArgs(TAG, "body.md", { draft: true }).at(-1), "--draft");
  assert.equal(releaseBody("x\n\n\n", FULL_SHA), `x\n\nSource: agentforge@${FULL_SHA}\n`);
});

test("a real run calls gh once with the dry-run argv, then checks the release is visible", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  const calls = [];
  const d = {
    ...deps(root),
    gh: (args) => {
      calls.push(args);
      return { status: 0 };
    },
    ghView: (tag) => {
      calls.push(["view", tag]);
      return { status: 0 };
    },
  };
  const result = main(["--tag", TAG, "--sha", FULL_SHA], d);
  assert.equal(result.published, true);
  assert.deepEqual(calls, [result.args, ["view", TAG]]);
});

// ---------- the deploy bundle ----------

test("compose.yml pins the image to the tag and builds nothing", () => {
  const compose = renderBundle(TAG, CADDY_SOURCE)["compose.yml"];
  assert.equal(IMAGE_REPO, "ghcr.io/kyoo032/dpsbuddy-ent");
  assert.ok(compose.includes(`\n    image: ${IMAGE}\n`), "app image pinned to the tag");
  assert.equal(compose.match(/image: ghcr\.io/g).length, 1, "one pinned app image");
  assert.doesNotMatch(compose, /^\s*build:/m, "the server never builds");
  assert.doesNotMatch(compose, /:latest\b/, "never a floating tag");
  assert.match(compose, /AGENTFORGE_SERVER: "1"/, "hosted mode is pinned, not left to .env");
  assert.match(compose, /\.\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
});

test(".env.example names every required variable with an empty value, and nothing else", () => {
  const env = renderBundle(TAG, CADDY_SOURCE)[".env.example"];
  const assigned = env
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0]);
  assert.deepEqual(assigned, REQUIRED_ENV);
  for (const name of REQUIRED_ENV) assert.ok(env.includes(`\n${name}=\n`), name);
});

test("the Caddyfile loses its comment lines, and every bundle file passes the mark check", () => {
  const bundle = renderBundle(TAG, CADDY_SOURCE);
  assert.deepEqual(Object.keys(bundle), BUNDLE_FILES);
  assert.doesNotMatch(bundle.Caddyfile, /packages\/host|# comment/);
  assert.match(bundle.Caddyfile, /reverse_proxy 127\.0\.0\.1:3000/);
  for (const [name, text] of Object.entries(bundle)) assert.deepEqual(forbiddenMarksInPublished(text), [], name);
  assert.deepEqual(forbiddenMarksInPublished("AGENTFORGE_SECRETS_KEY and agentforge@abc"), []);
  assert.deepEqual(forbiddenMarksInPublished("Custom Agents are parked"), ["agent"]);
});

test("--dry-run runs no docker, no tar, no gh, and only read-only git in this repo", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  const d = deps(root);
  const result = main(["--tag", TAG, "--sha", FULL_SHA, "--dry-run"], d);
  assert.equal(result.published, false);
  assert.deepEqual(d.dockerCalls, []);
  assert.deepEqual(d.tarCalls, []);
  assert.ok(d.gitCalls.length > 0);
  for (const call of d.gitCalls) {
    assert.ok(READ_ONLY_GIT.has(call.sub), `git ${call.sub} in a dry run`);
    assert.equal(call.cwd, root);
  }
  assert.equal(existsSync(result.workDir), false, "the temp dir is gone");
});

test("a real run builds from a git archive of the sha, pushes the image, then the bundle, then the release", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  const d = deps(root);
  const gh = recordingGh();
  const result = main(["--tag", TAG, "--sha", FULL_SHA], { ...d, ...gh });
  const archive = d.gitCalls.find((call) => call.sub === "archive");
  assert.equal(archive.cwd, root);
  assert.equal(archive.args.at(-1), FULL_SHA, "the image comes from <sha>, not the working tree");
  assert.deepEqual(
    d.dockerCalls.map((call) => call.args),
    [
      ["build", "-f", "webapp-deploy/Dockerfile", "-t", IMAGE, "."],
      ["push", IMAGE],
    ],
  );
  assert.ok(d.dockerCalls.every((call) => call.cwd.endsWith("context") && call.cwd !== root));
  const order = d.gitCalls.map((call) => call.sub);
  assert.ok(order.indexOf("archive") < order.indexOf("clone"), "image before bundle");
  assert.deepEqual(gh.calls, [result.args, ["view", TAG]]);
  assert.equal(existsSync(result.workDir), false, "the temp dir, clone and context are gone");
});

test("the temp-dir bundle commit holds exactly the four files, as rizky, 'Release <tag>', no trailers", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  const d = deps(root);
  const result = main(["--tag", TAG, "--sha", FULL_SHA, "--skip-image"], { ...d, ...recordingGh() });
  assert.equal(d.commits.length, 1);
  const [commit] = d.commits;
  assert.deepEqual(commit.files, { ...renderBundle(TAG, CADDY_SOURCE), "README.md": README });
  assert.ok(commit.cwd.startsWith(result.workDir) && commit.cwd.endsWith("DPSBuddy-Ent"), "a temp clone");
  assert.deepEqual(commit.args.slice(-4), ["commit", "--quiet", "-m", `Release ${TAG}`], "plain message, no trailer");
  assert.ok(commit.args.includes("user.name=rizky"));
  const clone = d.gitCalls.find((call) => call.sub === "clone");
  assert.ok(clone.args.includes(RELEASE_REPO_URL));
  const pushes = d.gitCalls.filter((call) => call.sub === "push");
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].cwd, commit.cwd, "only the temp clone is pushed, never this repo");
  assert.deepEqual(pushes[0].args.slice(-2), ["origin", "HEAD:main"]);
  assert.equal(existsSync(commit.cwd), false, "the clone is deleted");
});

test("--skip-image skips docker and the archive only; bundle and release still run", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  const d = deps(root);
  const gh = recordingGh();
  const result = main(["--tag", TAG, "--sha", FULL_SHA, "--skip-image"], { ...d, ...gh });
  assert.deepEqual(d.dockerCalls, []);
  assert.deepEqual(d.tarCalls, []);
  assert.ok(!d.gitCalls.some((call) => call.sub === "archive"));
  assert.ok(d.gitCalls.some((call) => call.sub === "push"));
  assert.deepEqual(gh.calls, [result.args, ["view", TAG]]);
  assert.ok(result.body.endsWith(`Image: ${IMAGE}\n`), "the body still names the pinned image");
});

test("a file in the release repo that carries a banned mark stops the push", () => {
  const root = fakeRepo({ [TAG]: CLEAN_NOTES });
  const d = deps(root, { cloneReadme: "Written by an agent.\n" });
  assert.throws(
    () => main(["--tag", TAG, "--sha", FULL_SHA, "--skip-image"], { ...d, ...recordingGh() }),
    /refusing to publish README\.md: it contains "agent"/,
  );
  assert.equal(d.commits.length, 0);
  assert.ok(!d.gitCalls.some((call) => call.sub === "push"));
});
