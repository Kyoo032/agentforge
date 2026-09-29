const assert = require("node:assert/strict");
const {
  shouldQuitOnLastWindow,
  exitStrategy,
  reopenTarget,
  quitKillsChildren,
  relaunchPlan,
  legacyMigrationPlan,
  hostStatusRuntime,
  readEditFfmpeg,
  hasDebugSwitch,
} = require("./lifecycle.cjs");

// ---------- shouldQuitOnLastWindow ----------

assert.equal(shouldQuitOnLastWindow("win32"), true);
assert.equal(shouldQuitOnLastWindow("linux"), true);
assert.equal(shouldQuitOnLastWindow("darwin"), false, "mac: closing the window keeps the app in the Dock");

// ---------- exitStrategy ----------

assert.equal(exitStrategy({ platform: "win32", installingUpdate: false }), "taskkill-tree");
assert.equal(
  exitStrategy({ platform: "win32", installingUpdate: true }),
  "plain",
  "win32: a detached NSIS installer must survive the exit",
);
assert.equal(exitStrategy({ platform: "linux", installingUpdate: false }), "kill-children");
assert.equal(exitStrategy({ platform: "darwin", installingUpdate: false }), "kill-children");
assert.equal(
  exitStrategy({ platform: "darwin", installingUpdate: true }),
  "kill-children",
  "mac never installs via exit",
);

// ---------- quitKillsChildren: which platforms reach before-quit with live children ----------

assert.equal(quitKillsChildren("darwin"), true, "Cmd+Q must take ffmpeg down with the app");
assert.equal(quitKillsChildren("linux"), true);
assert.equal(quitKillsChildren("win32"), false, "win32 exits through taskkill /T, not app.quit");

// ---------- reopenTarget ----------

assert.equal(reopenTarget({ hostReady: false }), "splash");
assert.equal(reopenTarget({ hostReady: true }), "ui", "Dock reopen after boot goes straight to the renderer");
assert.equal(reopenTarget({}), "splash");
assert.equal(reopenTarget(undefined), "splash");

// ---------- relaunchPlan: Settings -> Start over, and any renderer-driven restart ----------

for (const platform of ["win32", "darwin"]) {
  assert.deepEqual(
    relaunchPlan({ platform, installingUpdate: false, exiting: false }),
    { ok: true, killChildren: true, strategy: "relaunch-exit" },
    `${platform}: relaunch is app.relaunch() + app.exit(0), never the taskkill tree walk`,
  );
  assert.deepEqual(
    relaunchPlan({ platform, installingUpdate: true, exiting: false }),
    { ok: false, reason: "installing-update" },
    `${platform}: never fight the installer that is already replacing our files`,
  );
  assert.deepEqual(
    relaunchPlan({ platform, installingUpdate: false, exiting: true }),
    { ok: false, reason: "already-exiting" },
    `${platform}: a close / quit is already in flight`,
  );
  assert.deepEqual(
    relaunchPlan({ platform, installingUpdate: true, exiting: true }),
    { ok: false, reason: "installing-update" },
    `${platform}: the installer wins over an exit already in flight`,
  );
  assert.deepEqual(relaunchPlan({ platform }), { ok: true, killChildren: true, strategy: "relaunch-exit" });
}

assert.equal(
  relaunchPlan({ platform: "win32", installingUpdate: false, exiting: false }).killChildren,
  true,
  "win32: the tree walk is skipped here, so tracked ffmpeg must be signalled explicitly",
);
assert.equal(
  relaunchPlan({ platform: "darwin", installingUpdate: false, exiting: false }).killChildren,
  true,
  "darwin: Cmd+Q is not the only path that ends the process any more; relaunch is the other one",
);

// ---------- legacyMigrationPlan: one-shot copy of an older install's desk ----------

const legacyDirs = ["C:/AppData/@agentforge/desktop", "C:/AppData/Agentforge"];

assert.equal(
  legacyMigrationPlan({ markerExists: false, destHasDb: false, legacyDirs }),
  "copy",
  "first launch after an upgrade: the older desk is copied forward",
);
assert.equal(
  legacyMigrationPlan({ markerExists: false, destHasDb: false, legacyDirs: [] }),
  "mark-only",
  "clean first launch: nothing to copy, but never ask again",
);
assert.equal(
  legacyMigrationPlan({ markerExists: false, destHasDb: true, legacyDirs }),
  "mark-only",
  "this desk already has a database: leave it alone and record the decision",
);
assert.equal(
  legacyMigrationPlan({ markerExists: true, destHasDb: false, legacyDirs }),
  "skip",
  "after a reset: marker exists, no db — the wiped data must not come back from the legacy desk",
);
assert.equal(
  legacyMigrationPlan({ markerExists: true, destHasDb: false, legacyDirs: [] }),
  "skip",
  "the marker wins even with nothing to copy",
);
assert.equal(
  legacyMigrationPlan({ markerExists: true, destHasDb: true, legacyDirs }),
  "skip",
  "the marker is checked before anything touches the filesystem",
);
assert.equal(legacyMigrationPlan({}), "mark-only", "no signals at all: record and move on");
assert.equal(legacyMigrationPlan(undefined), "mark-only");
assert.equal(
  legacyMigrationPlan({ markerExists: "yes", destHasDb: "no", legacyDirs: "C:/x" }),
  "mark-only",
  "only literal booleans and a real array count",
);

// ---------- hostStatusRuntime: what host-status.json records after the desk is resolved ----------

assert.deepEqual(
  hostStatusRuntime({ hasOpenai: true, envRuntime: undefined }),
  { runtime: "ai", hasOpenai: true },
  "a key on the resolved desk is a live runtime, whatever the env says",
);
assert.deepEqual(hostStatusRuntime({ hasOpenai: true, envRuntime: "stub" }), { runtime: "ai", hasOpenai: true });
assert.deepEqual(hostStatusRuntime({ hasOpenai: false, envRuntime: undefined }), { runtime: "stub", hasOpenai: false });
assert.deepEqual(
  hostStatusRuntime({ hasOpenai: false, envRuntime: "ai" }),
  { runtime: "ai", hasOpenai: false },
  "the env override still decides when the desk holds no key",
);
assert.deepEqual(
  hostStatusRuntime({ hasOpenai: false, envRuntime: "   " }),
  { runtime: "stub", hasOpenai: false },
  "a blank env value is not a runtime",
);
assert.deepEqual(hostStatusRuntime(undefined), { runtime: "stub", hasOpenai: false });
assert.deepEqual(
  hostStatusRuntime({ hasOpenai: "yes" }),
  { runtime: "ai", hasOpenai: true },
  "hasOpenai is coerced, never passed through",
);

// ---------- hasDebugSwitch: argv a packaged build must refuse to start on ----------

const cleanArgv = ["C:\\Program Files\\Nultron\\Nultron.exe", "--no-sandbox-is-not-a-debugger"];

assert.equal(hasDebugSwitch(cleanArgv), false, "an ordinary launch starts normally");
assert.equal(hasDebugSwitch(["Nultron.exe"]), false);
assert.equal(hasDebugSwitch([]), false);
assert.equal(hasDebugSwitch(undefined), false, "no argv is not a debug launch");
assert.equal(hasDebugSwitch("--inspect"), false, "only a real array is read");
assert.equal(hasDebugSwitch([null, 42, {}]), false, "non-string entries are ignored, not crashed on");

for (const flag of [
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--remote-allow-origins",
  "--inspect",
  "--inspect-brk",
  "--inspect-port",
  "--inspect-publish-uid",
]) {
  assert.equal(hasDebugSwitch(["Nultron.exe", flag]), true, `${flag} alone must refuse the launch`);
  assert.equal(hasDebugSwitch(["Nultron.exe", `${flag}=9229`]), true, `${flag}=<value> must refuse the launch`);
  assert.equal(
    hasDebugSwitch(["Nultron.exe", "--some-file.txt", flag, "--another"]),
    true,
    `${flag} is found wherever it sits in argv`,
  );
}

assert.equal(hasDebugSwitch(["Nultron.exe", "--remote-debugging-port=0"]), true, "port 0 still opens an endpoint");
assert.equal(hasDebugSwitch(["Nultron.exe", "--remote-allow-origins=*"]), true);
assert.equal(
  hasDebugSwitch(["Nultron.exe", "--INSPECT-BRK=5858"]),
  true,
  "Chromium switch parsing is case-insensitive",
);
assert.equal(
  hasDebugSwitch(["Nultron.exe", "  --inspect  "]),
  true,
  "surrounding whitespace does not smuggle it past",
);

assert.equal(
  hasDebugSwitch(["Nultron.exe", "--inspector-notes.txt"]),
  false,
  "a look-alike that is not an --inspect- switch still starts",
);
assert.equal(hasDebugSwitch(["Nultron.exe", "inspect"]), false, "a bare word is a file argument, not a switch");
assert.equal(hasDebugSwitch(["Nultron.exe", "--remote-debugging"]), false, "only the real switch names count");

// ---------- boot order: the ffmpeg probe stays behind the first paint ----------
//
// main.cjs needs Electron, so its ordering is pinned from the source text. `bootstrapPackaged` once
// awaited GET /api/v1/edit/doctor ahead of navigateToUi(): a PATH walk plus `ffmpeg -version`, about
// 270 ms of the ~290 ms between the host answering and the window loading the UI.

{
  const main = require("node:fs").readFileSync(require("node:path").join(__dirname, "main.cjs"), "utf8");
  const start = main.indexOf("async function bootstrapPackaged()");
  const end = main.indexOf("async function recordEditFfmpeg", start);
  assert.ok(start > 0 && end > start, "found bootstrapPackaged in main.cjs");
  const body = main.slice(start, end);
  assert.equal(
    body.includes('"/api/v1/edit/doctor"'),
    false,
    "bootstrapPackaged must not wait on the Edit doctor itself",
  );
  const navigate = body.indexOf("await navigateToUi()");
  const record = body.indexOf("recordEditFfmpeg(");
  assert.ok(navigate > 0, "bootstrapPackaged still navigates to the UI");
  assert.ok(record > navigate, "the ffmpeg probe starts only after navigateToUi() has resolved");
  assert.equal(/await\s+recordEditFfmpeg/.test(body), false, "and boot never awaits it");
  const statusWrite = body.indexOf("writeHostStatus(");
  assert.ok(
    statusWrite > 0 && statusWrite < navigate,
    "host-status.json is written before the window loads, without the probe",
  );
}

// ---------- readEditFfmpeg: the block boot adds to host-status.json after the window loads ----------

async function editFfmpegCases() {
  const found = { found: true, path: "C:/tools/ffmpeg.exe", version: "8.1.1" };
  assert.deepEqual(
    await readEditFfmpeg(async () => ({ type: "json", status: 200, body: { ffmpeg: found, asr: {}, fonts: [] } })),
    found,
    "the doctor's ffmpeg block is carried through untouched",
  );
  const missing = { found: false, path: null, version: null, reason: "missing", setup: { platform: "windows" } };
  assert.deepEqual(
    await readEditFfmpeg(async () => ({ type: "json", status: 200, body: { ffmpeg: missing } })),
    missing,
    "a missing ffmpeg is still an answer, not a failure",
  );
  assert.equal(
    await readEditFfmpeg(async () => {
      throw new Error("host not ready");
    }),
    null,
    "a doctor that throws leaves null, never an unhandled rejection",
  );
  assert.equal(
    await readEditFfmpeg(() => {
      throw new Error("threw before returning a promise");
    }),
    null,
    "a synchronous throw is caught too",
  );
  assert.equal(await readEditFfmpeg(async () => ({ type: "error", status: 500 })), null, "only a json report counts");
  assert.equal(
    await readEditFfmpeg(async () => ({ type: "json", body: {} })),
    null,
    "a report with no ffmpeg block is null",
  );
  assert.equal(
    await readEditFfmpeg(async () => ({ type: "json", body: { ffmpeg: "yes" } })),
    null,
    "the block must be an object",
  );
  assert.equal(await readEditFfmpeg(async () => undefined), null);
}

editFfmpegCases()
  .then(() => {
    console.log("lifecycle.test.cjs: ok");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
