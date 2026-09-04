/**
 * GitHub Releases updater for the public Agentforge build only.
 * Flavors (Kemenkeu / Metranet) must not call this.
 */
function updatesEnabled(productName, isPackaged) {
  return Boolean(isPackaged && productName === "Agentforge");
}

function loadAutoUpdater() {
  try {
    return require("electron-updater").autoUpdater;
  } catch {
    return null;
  }
}

function registerAutoUpdate({ app, ipcMain, BrowserWindow, productName }) {
  const currentVersion = app.getVersion();
  const supported = updatesEnabled(productName, app.isPackaged);
  const autoUpdater = supported ? loadAutoUpdater() : null;

  /** @type {{ supported: boolean, status: string, currentVersion: string, version?: string, percent?: number, message?: string }} */
  let state = {
    supported: Boolean(supported && autoUpdater),
    status: supported && autoUpdater ? "idle" : "unavailable",
    currentVersion,
  };

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

  ipcMain.handle("updates:state", () => state);

  if (!autoUpdater) {
    ipcMain.handle("updates:check", () => state);
    ipcMain.handle("updates:download", () => state);
    ipcMain.handle("updates:install", () => {
      throw new Error("Updates are available in the installed Agentforge app.");
    });
    return { supported: false };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

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
    setState({
      status: "error",
      message: error instanceof Error ? error.message : "Could not check for updates.",
    });
  });

  ipcMain.handle("updates:check", async () => {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version;
    if (version && version !== currentVersion) {
      return setState({ status: "available", version, message: undefined });
    }
    return setState({ status: "current", version: undefined, message: undefined });
  });

  ipcMain.handle("updates:download", async () => {
    await autoUpdater.downloadUpdate();
    return state.status === "ready" ? state : setState({ status: "ready" });
  });

  ipcMain.handle("updates:install", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  void autoUpdater.checkForUpdates().catch(() => {
    // First launch / no latest.yml yet is not a product fail.
  });

  return { supported: true };
}

module.exports = { updatesEnabled, registerAutoUpdate };
