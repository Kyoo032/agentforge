/**
 * Window and process lifecycle decisions for the Electron shell, per platform.
 *
 * Pure functions so the Windows / macOS split is testable without Electron. The rules live in
 * apps/desktop/platform/README.md (matrix) and the per-OS AGENTS.md files; change both together.
 *
 * - Windows: closing the window exits the process tree (`taskkill /T`), except while an update
 *   installs, when the detached NSIS installer must outlive us.
 * - macOS: closing the window keeps the app in the Dock; Cmd+Q (the `quit` role) is the only exit.
 *   Nothing walks the process tree, so tracked children (ffmpeg) are signalled on `before-quit`.
 * - Linux: exits on last window like Windows, but has no taskkill; tracked children are signalled.
 */

/** @typedef {"plain" | "taskkill-tree" | "kill-children"} ExitStrategy */
/** @typedef {"splash" | "ui"} ReopenTarget */
/** @typedef {{ ok: false, reason: "installing-update" | "already-exiting" }} RelaunchRefused */
/** @typedef {{ ok: true, killChildren: boolean, strategy: "relaunch-exit" }} RelaunchAllowed */
/** @typedef {"skip" | "mark-only" | "copy"} LegacyMigrationPlan */

function shouldQuitOnLastWindow(platform) {
  return platform !== "darwin";
}

/**
 * How `exitApp()` should leave the process.
 * @param {{ platform: string, installingUpdate: boolean }} input
 * @returns {ExitStrategy}
 */
function exitStrategy({ platform, installingUpdate }) {
  if (platform === "win32") {
    return installingUpdate ? "plain" : "taskkill-tree";
  }
  return "kill-children";
}

/** Platforms whose quit path is `app.quit()` (so `before-quit` fires) and that have no tree kill. */
function quitKillsChildren(platform) {
  return platform !== "win32";
}

/**
 * What a freshly created window should load. After the host booted (Dock reopen on macOS) the
 * splash would never advance, so the window goes straight to the renderer.
 * @param {{ hostReady?: boolean } | undefined} input
 * @returns {ReopenTarget}
 */
function reopenTarget(input) {
  return input && input.hostReady === true ? "ui" : "splash";
}

/**
 * Whether the renderer's "Start over" / restart request may run, and how to leave the process.
 *
 * Same answer on every platform, on purpose:
 * - `strategy` is always "relaunch-exit": `app.relaunch()` then `app.exit(0)`. It is never the
 *   Windows `taskkill /F /PID <pid> /T` walk from `exitStrategy()`: Electron's relauncher is a
 *   detached child of this process, so the tree walk would kill the very process that is supposed
 *   to start us again and the app would simply disappear. The relauncher waits for this process to
 *   exit before spawning the new one, so the single-instance lock is released in time.
 * - `killChildren` is true everywhere, because we are no longer using the tree walk: a tracked
 *   ffmpeg must not outlive the run and reappear next to the new instance.
 *
 * Refusals:
 * - `installing-update`: the detached NSIS installer is already running (see
 *   platform/windows/AGENTS.md); relaunching now would fight it over the files it is replacing.
 *   The installer restarts the app itself.
 * - `already-exiting`: a close / Cmd+Q / update install is in flight; do not race it.
 *
 * `platform` is part of the input and deliberately unread: the answer is the same on win32 and
 * darwin, and callers keep passing it so a future per-OS rule lands here instead of in main.cjs.
 *
 * @param {{ platform: string, installingUpdate?: boolean, exiting?: boolean }} input
 * @returns {RelaunchRefused | RelaunchAllowed}
 */
function relaunchPlan(input) {
  if (input?.installingUpdate === true) {
    return { ok: false, reason: "installing-update" };
  }
  if (input?.exiting === true) {
    return { ok: false, reason: "already-exiting" };
  }
  return { ok: true, killChildren: true, strategy: "relaunch-exit" };
}

/**
 * Whether this launch should copy an older install's data folder into the current userData.
 *
 * The migration is **one-shot**, recorded by `userData/legacy-migrated.json`. Before that marker
 * existed the only signal was "userData has no `agentforge.sqlite`", which is exactly the state a
 * "Reset to a fresh install" leaves behind: the second launch after a reset would copy the forgotten
 * key, threads and media straight back out of the legacy desk. The marker is written after *any*
 * decision — copied, nothing to copy, or the desk was already populated — so the question is asked
 * once per install and never again.
 *
 * `legacyDirs` is the caller's already-filtered list of older desks that actually hold a database,
 * oldest first; the newest (last) one wins.
 *
 * @param {{ markerExists?: boolean, destHasDb?: boolean, legacyDirs?: string[] }} input
 * @returns {LegacyMigrationPlan}
 */
function legacyMigrationPlan(input) {
  if (input?.markerExists === true) {
    return "skip";
  }
  if (input?.destHasDb === true) {
    return "mark-only";
  }
  const legacyDirs = Array.isArray(input?.legacyDirs) ? input.legacyDirs : [];
  return legacyDirs.length > 0 ? "copy" : "mark-only";
}

/**
 * What `host-status.json` should record about the runtime, given the settings slice for the desk
 * the host just resolved.
 *
 * The desk is the whole point. Settings are stored per workspace, so a read that names no desk
 * lands on the empty `__default__` slice until something stamps `workspace-id.txt` — on a fresh
 * install that is every boot, and the status file would claim "stub" / no key minutes after
 * onboarding saved one, which `doctor --desktop` then reports as a false negative. Boot resolves a
 * tenant first and passes that desk's slice here.
 *
 * @param {{ hasOpenai?: boolean, envRuntime?: string }} input
 * @returns {{ runtime: string, hasOpenai: boolean }}
 */
function hostStatusRuntime(input) {
  const hasOpenai = Boolean(input && input.hasOpenai);
  const envRuntime = input && typeof input.envRuntime === "string" ? input.envRuntime.trim() : "";
  return { runtime: hasOpenai ? "ai" : envRuntime || "stub", hasOpenai };
}

/**
 * Switches that would hand a second process a debugger on this one, by exact name (the part before
 * any `=value`). `--inspect-*` is matched by prefix so `--inspect-brk`, `--inspect-port` and
 * `--inspect-publish-uid` are all covered without listing every Node build's spelling.
 */
const DEBUG_SWITCH_NAMES = Object.freeze([
  "--remote-debugging-port",
  "--remote-debugging-pipe",
  "--remote-allow-origins",
  "--inspect",
]);

/**
 * Whether this argv asks the process to open a debugger, in which case a packaged build must refuse
 * to start at all.
 *
 * The packaged main process holds the decrypted gateway key, the SQLite handle and a preload bridge
 * that dispatches straight into the host. A DevTools protocol endpoint on any of those is a full
 * read of the user's desk by whatever could set our command line — a shortcut someone edited, a
 * "launch with" registration, another program spawning our exe. There is no legitimate packaged use:
 * debugging happens in webdev, where `app.isPackaged` is false and this never runs.
 *
 * Both forms count, `--inspect` and `--inspect=9229`, and matching is case-insensitive because
 * Chromium's own switch parsing is.
 *
 * @param {readonly string[] | undefined} argv
 * @returns {boolean}
 */
function hasDebugSwitch(argv) {
  if (!Array.isArray(argv)) {
    return false;
  }
  return argv.some((arg) => {
    if (typeof arg !== "string") {
      return false;
    }
    const name = arg.split("=", 1)[0].trim().toLowerCase();
    return DEBUG_SWITCH_NAMES.includes(name) || name.startsWith("--inspect-");
  });
}

module.exports = {
  shouldQuitOnLastWindow,
  exitStrategy,
  quitKillsChildren,
  reopenTarget,
  relaunchPlan,
  legacyMigrationPlan,
  hostStatusRuntime,
  hasDebugSwitch,
};
