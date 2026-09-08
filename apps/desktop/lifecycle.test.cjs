const assert = require("node:assert/strict");
const { shouldQuitOnLastWindow, exitStrategy, reopenTarget, quitKillsChildren } = require("./lifecycle.cjs");

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
assert.equal(exitStrategy({ platform: "darwin", installingUpdate: true }), "kill-children", "mac never installs via exit");

// ---------- quitKillsChildren: which platforms reach before-quit with live children ----------

assert.equal(quitKillsChildren("darwin"), true, "Cmd+Q must take ffmpeg down with the app");
assert.equal(quitKillsChildren("linux"), true);
assert.equal(quitKillsChildren("win32"), false, "win32 exits through taskkill /T, not app.quit");

// ---------- reopenTarget ----------

assert.equal(reopenTarget({ hostReady: false }), "splash");
assert.equal(reopenTarget({ hostReady: true }), "ui", "Dock reopen after boot goes straight to the renderer");
assert.equal(reopenTarget({}), "splash");
assert.equal(reopenTarget(undefined), "splash");

console.log("lifecycle.test.cjs: ok");
