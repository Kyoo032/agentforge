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

module.exports = {
  shouldQuitOnLastWindow,
  exitStrategy,
  quitKillsChildren,
  reopenTarget,
};
