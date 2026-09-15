const assert = require("node:assert/strict");
const {
  shouldQuitOnLastWindow,
  exitStrategy,
  reopenTarget,
  quitKillsChildren,
  relaunchPlan,
  legacyMigrationPlan,
  hostStatusRuntime,
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

const cleanArgv = ["C:\\Program Files\\DPSBuddy\\DPSBuddy.exe", "--no-sandbox-is-not-a-debugger"];

assert.equal(hasDebugSwitch(cleanArgv), false, "an ordinary launch starts normally");
assert.equal(hasDebugSwitch(["DPSBuddy.exe"]), false);
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
  assert.equal(hasDebugSwitch(["DPSBuddy.exe", flag]), true, `${flag} alone must refuse the launch`);
  assert.equal(hasDebugSwitch(["DPSBuddy.exe", `${flag}=9229`]), true, `${flag}=<value> must refuse the launch`);
  assert.equal(
    hasDebugSwitch(["DPSBuddy.exe", "--some-file.txt", flag, "--another"]),
    true,
    `${flag} is found wherever it sits in argv`,
  );
}

assert.equal(hasDebugSwitch(["DPSBuddy.exe", "--remote-debugging-port=0"]), true, "port 0 still opens an endpoint");
assert.equal(hasDebugSwitch(["DPSBuddy.exe", "--remote-allow-origins=*"]), true);
assert.equal(
  hasDebugSwitch(["DPSBuddy.exe", "--INSPECT-BRK=5858"]),
  true,
  "Chromium switch parsing is case-insensitive",
);
assert.equal(
  hasDebugSwitch(["DPSBuddy.exe", "  --inspect  "]),
  true,
  "surrounding whitespace does not smuggle it past",
);

assert.equal(
  hasDebugSwitch(["DPSBuddy.exe", "--inspector-notes.txt"]),
  false,
  "a look-alike that is not an --inspect- switch still starts",
);
assert.equal(hasDebugSwitch(["DPSBuddy.exe", "inspect"]), false, "a bare word is a file argument, not a switch");
assert.equal(hasDebugSwitch(["DPSBuddy.exe", "--remote-debugging"]), false, "only the real switch names count");

console.log("lifecycle.test.cjs: ok");
