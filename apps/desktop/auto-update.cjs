/**
 * GitHub Releases updater for the public DPSBuddy build only.
 * Flavors (Kemenkeu / Metranet) must not call this.
 */
const fs = require("node:fs");
const path = require("node:path");
const { PUBLIC_PRODUCT_NAME } = require("./brand-read.cjs");
const { isTrustedSender } = require("./navigation.cjs");

const MAX_MESSAGE_CHARS = 160;
const GENERIC_MESSAGE = "Could not check for updates.";
const NOT_FOUND_MESSAGE = "Update feed not found (404). The release repository is unreachable or has no releases.";
const VERIFY_FAILED_MESSAGE = "The downloaded installer failed verification. Try again.";
const NO_RELEASE_MESSAGE = "No published release was found.";

const NETWORK_MESSAGES = Object.freeze({
  ENOTFOUND: "Could not reach GitHub. Check your internet connection.",
  EAI_AGAIN: "Could not reach GitHub. Check your internet connection.",
  ECONNREFUSED: "GitHub refused the connection. Try again later.",
  ECONNRESET: "The connection to GitHub was interrupted. Try again.",
  ETIMEDOUT: "Timed out while contacting GitHub. Try again.",
});

const UPDATER_MESSAGES = Object.freeze({
  ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: "The newest release has no latest.yml, so it cannot be installed from here.",
  ERR_UPDATER_LATEST_VERSION_NOT_FOUND: NO_RELEASE_MESSAGE,
  ERR_UPDATER_NO_PUBLISHED_VERSIONS: NO_RELEASE_MESSAGE,
  ERR_UPDATER_RELEASE_NOT_FOUND: NO_RELEASE_MESSAGE,
  ERR_UPDATER_ASSET_NOT_FOUND: "The newest release is missing its installer file.",
  ERR_UPDATER_INVALID_SIGNATURE: VERIFY_FAILED_MESSAGE,
  ERR_CHECKSUM_MISMATCH: VERIFY_FAILED_MESSAGE,
});

/**
 * electron-updater refuses to install on macOS unless the app is code-signed, and the mac build
 * ships with `identity: null`. Offering a download there would end in an install that cannot run,
 * so darwin reports unsupported until signing exists (apps/desktop/platform/macos/AGENTS.md).
 */
const UNSIGNED_PLATFORMS = new Set(["darwin"]);
const MAC_MANUAL_MESSAGE = "Updates on macOS are manual for now. Download the new .dmg from GitHub Releases.";
const NOT_INSTALLED_MESSAGE = "Updates are available in the installed DPSBuddy app.";

/**
 * What every `updates:*` channel answers a frame that is not the main renderer.
 *
 * It is the snapshot an unsupported build already returns, so the renderer renders it with copy it
 * already has and nothing new reaches the UI — and it names no version, so a subframe cannot read
 * the install's version out of a channel it should never have reached. Refusing is a return, never a
 * throw: `updates:install` throws for a real unsupported build, and a refusal must not look like one.
 */
const REFUSED_STATE = Object.freeze({ supported: false, status: "unavailable" });

function updatesEnabled(productName, isPackaged, platform = process.platform) {
  return Boolean(isPackaged && productName === PUBLIC_PRODUCT_NAME && !UNSIGNED_PLATFORMS.has(platform));
}

/** Why updates are off for this build, in user-facing words; undefined when the generic line fits. */
function unsupportedMessage(productName, isPackaged, platform = process.platform) {
  if (isPackaged && productName === PUBLIC_PRODUCT_NAME && UNSIGNED_PLATFORMS.has(platform)) {
    return MAC_MANUAL_MESSAGE;
  }
  return undefined;
}

/** Electron's net.isOnline() when available (main process); tests and non-Electron hosts count as online. */
function isOffline() {
  try {
    const { net } = require("electron");
    return Boolean(net && typeof net.isOnline === "function" && !net.isOnline());
  } catch {
    return false;
  }
}

function loadAutoUpdater() {
  try {
    return require("electron-updater").autoUpdater;
  } catch {
    return null;
  }
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : "";
}

function errorMessage(error) {
  return typeof error?.message === "string" ? error.message : "";
}

/** electron-updater HttpError: statusCode, code "HTTP_ERROR_<n>", message "<n> <text>\nHeaders: {...}". */
function httpStatus(error) {
  if (typeof error?.statusCode === "number" && error.statusCode > 0) {
    return error.statusCode;
  }
  const fromCode = /^HTTP_ERROR_(\d{3})$/.exec(errorCode(error));
  if (fromCode) {
    return Number(fromCode[1]);
  }
  const fromMessage = /^\s*(\d{3})\b/.exec(errorMessage(error));
  return fromMessage ? Number(fromMessage[1]) : null;
}

function firstLine(text) {
  return text.split(/\r?\n/, 1)[0].trim().slice(0, MAX_MESSAGE_CHARS);
}

/** Short, single-line, user-facing text. Never includes the header dump electron-updater appends. */
function describeUpdateError(error) {
  if (!error || typeof error !== "object") {
    return GENERIC_MESSAGE;
  }
  const status = httpStatus(error);
  if (status === 404) {
    return NOT_FOUND_MESSAGE;
  }
  if (status) {
    return `GitHub returned ${status} while checking for updates.`;
  }
  const code = errorCode(error);
  const known = NETWORK_MESSAGES[code] || UPDATER_MESSAGES[code];
  if (known) {
    return known;
  }
  const message = errorMessage(error);
  if (/checksum mismatch|sha512/i.test(message)) {
    return VERIFY_FAILED_MESSAGE;
  }
  return firstLine(message) || GENERIC_MESSAGE;
}

/** Raw detail for the log file; the UI only ever sees describeUpdateError(). */
function rawErrorDetail(error) {
  const code = errorCode(error);
  const message = errorMessage(error) || String(error);
  return code ? `${message} [code=${code}]` : message;
}

function formatLogArg(arg) {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    return rawErrorDetail(arg);
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

/**
 * Minimal electron-updater compatible logger appending one line per entry.
 * Never throws: a broken log path must not take the updater down. A null path disables output.
 */
function createUpdateLogger(logPath) {
  const write = (level, args) => {
    if (!logPath) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      // One line per entry: HttpError messages embed "\nHeaders: {...}", so fold newlines.
      const text = args
        .map(formatLogArg)
        .join(" ")
        .replace(/\s*\r?\n\s*/g, " | ");
      fs.appendFileSync(logPath, `${new Date().toISOString()} ${level} ${text}\n`, "utf8");
    } catch {
      // Logging is best-effort only.
    }
  };
  return {
    debug: (...args) => write("debug", args),
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args),
  };
}

/** app.getPath("logs") throws outside a real Electron app; fall back to no file logging. */
function resolveUpdateLogPath(app) {
  try {
    return path.join(app.getPath("logs"), "updater.log");
  } catch {
    return null;
  }
}

function registerAutoUpdate({
  app,
  ipcMain,
  BrowserWindow,
  productName,
  onInstallStart,
  autoUpdaterOverride,
  getMainWindow,
  platform = process.platform,
}) {
  const currentVersion = app.getVersion();
  const supported = updatesEnabled(productName, app.isPackaged, platform);
  const autoUpdater = supported ? (autoUpdaterOverride ?? loadAutoUpdater()) : null;
  const logger = createUpdateLogger(autoUpdater ? resolveUpdateLogPath(app) : null);
  const unsupportedReason = unsupportedMessage(productName, app.isPackaged, platform);

  /** @type {{ supported: boolean, status: string, currentVersion: string, version?: string, percent?: number, message?: string }} */
  let state = {
    supported: Boolean(supported && autoUpdater),
    status: supported && autoUpdater ? "idle" : "unavailable",
    currentVersion,
    ...(supported && autoUpdater ? {} : { message: unsupportedReason }),
  };

  /**
   * Whether this ipc call came from the main renderer. Downloading and installing replace the app on
   * disk and restart it, and `getMainWindow` is read per call because a macOS Dock reopen builds a
   * new window. A host that passes no `getMainWindow` at all trusts nobody.
   */
  function trusted(event) {
    return isTrustedSender(event, typeof getMainWindow === "function" ? getMainWindow() : null);
  }

  function broadcast() {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("updates:status", state);
      }
    }
  }

  function setState(patch) {
    state = { ...state, ...patch, supported: Boolean(supported && autoUpdater), currentVersion };
    broadcast();
    return state;
  }

  function failState(context, error) {
    logger.error(`${context}: ${rawErrorDetail(error)}`);
    return setState({ status: "error", message: describeUpdateError(error) });
  }

  /** Runs an IPC task; a thrown error becomes an error state the renderer can render, never a raw rejection. */
  async function guarded(context, task) {
    try {
      return await task();
    } catch (error) {
      return failState(context, error);
    }
  }

  ipcMain.handle("updates:state", (event) => (trusted(event) ? state : REFUSED_STATE));

  if (!autoUpdater) {
    ipcMain.handle("updates:check", (event) => (trusted(event) ? state : REFUSED_STATE));
    ipcMain.handle("updates:download", (event) => (trusted(event) ? state : REFUSED_STATE));
    ipcMain.handle("updates:install", (event) => {
      if (!trusted(event)) {
        return REFUSED_STATE;
      }
      throw new Error(unsupportedReason ?? NOT_INSTALLED_MESSAGE);
    });
    return { supported: false };
  }

  autoUpdater.autoDownload = false;
  // This app exits via app.exit() (see exitApp in main.cjs), so Electron's "quit" event never fires and
  // install-on-quit would be dead code; installs go through updates:install -> quitAndInstall only.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = logger;

  autoUpdater.on("checking-for-update", () => {
    setState({ status: "checking", message: undefined });
  });
  autoUpdater.on("update-available", (info) => {
    setState({ status: "available", version: info?.version, message: undefined });
  });
  autoUpdater.on("update-not-available", () => {
    setState({ status: "current", version: undefined, message: undefined });
  });
  autoUpdater.on("download-progress", (progress) => {
    setState({
      status: "downloading",
      percent: typeof progress?.percent === "number" ? progress.percent : undefined,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    setState({ status: "ready", version: info?.version, percent: 100, message: undefined });
  });
  autoUpdater.on("error", (error) => {
    failState("updater error", error);
  });

  ipcMain.handle("updates:check", (event) => {
    if (!trusted(event)) {
      return REFUSED_STATE;
    }
    return guarded("check failed", async () => {
      const result = await autoUpdater.checkForUpdates();
      // electron-updater's semver compare: an older published release (e.g. right after a fresh
      // install that is ahead of the public feed) is "current", never a downgrade offer.
      const version = result?.updateInfo?.version;
      if (result?.isUpdateAvailable && version) {
        return setState({ status: "available", version, message: undefined });
      }
      return setState({ status: "current", version: undefined, message: undefined });
    });
  });

  ipcMain.handle("updates:download", (event) => {
    if (!trusted(event)) {
      return REFUSED_STATE;
    }
    return guarded("download failed", async () => {
      await autoUpdater.downloadUpdate();
      return state.status === "ready" ? state : setState({ status: "ready" });
    });
  });

  ipcMain.handle("updates:install", (event) => {
    if (!trusted(event)) {
      return REFUSED_STATE;
    }
    if (state.status !== "ready") {
      // Nothing downloaded: quitAndInstall would be a no-op, and flagging the install would skip the
      // taskkill cleanup on the next ordinary exit for no reason.
      return state;
    }
    if (typeof onInstallStart === "function") {
      onInstallStart();
    }
    logger.info(`installing ${state.version ?? "update"} over ${currentVersion}`);
    autoUpdater.quitAndInstall(false, true);
    return state;
  });

  if (isOffline()) {
    // No network: the manual Check button still works later; nothing to log as an error.
    logger.info("startup check skipped: offline");
  } else {
    void autoUpdater.checkForUpdates().catch((error) => {
      // First launch / no latest.yml yet is not a product fail; keep the detail on disk only.
      logger.warn(`startup check skipped: ${rawErrorDetail(error)}`);
    });
  }

  return { supported: true };
}

module.exports = {
  updatesEnabled,
  unsupportedMessage,
  describeUpdateError,
  createUpdateLogger,
  resolveUpdateLogPath,
  registerAutoUpdate,
};
