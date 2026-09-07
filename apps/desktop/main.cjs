const { app, BrowserWindow, Menu, dialog, ipcMain, protocol } = require("electron");
const { registerAutoUpdate } = require("./auto-update.cjs");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BRAND = {
  productName: "Agentforge",
  gatewayName: "Toko Token",
  gatewayBaseUrl: "https://api.tokotokenai.com/v1",
};

function loadBrandConfig() {
  if (!app.isPackaged) {
    return DEFAULT_BRAND;
  }
  const file = path.join(process.resourcesPath, "brand", "brand.json");
  try {
    if (!fs.existsSync(file)) {
      return DEFAULT_BRAND;
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const productName =
      typeof parsed.productName === "string" && parsed.productName.trim()
        ? parsed.productName.trim()
        : DEFAULT_BRAND.productName;
    const gatewayName =
      typeof parsed.gatewayName === "string" && parsed.gatewayName.trim()
        ? parsed.gatewayName.trim()
        : DEFAULT_BRAND.gatewayName;
    const gatewayBaseUrl =
      typeof parsed.gatewayBaseUrl === "string" && parsed.gatewayBaseUrl.trim()
        ? parsed.gatewayBaseUrl.trim().replace(/\/+$/, "")
        : DEFAULT_BRAND.gatewayBaseUrl;
    return { productName, gatewayName, gatewayBaseUrl };
  } catch (err) {
    console.warn("brand.json unreadable, using Agentforge defaults:", err.message);
    return DEFAULT_BRAND;
  }
}

const brand = loadBrandConfig();
const PRODUCT_NAME = brand.productName;
const KEYCHAIN_SERVICE = PRODUCT_NAME;
const KEYCHAIN_ACCOUNT = "wrap-key";
const WEBDEV_URL = "http://127.0.0.1:3000";

process.env.AGENTFORGE_PRODUCT_NAME = brand.productName;
process.env.AGENTFORGE_GATEWAY_NAME = brand.gatewayName;
process.env.AGENTFORGE_GATEWAY_URL = brand.gatewayBaseUrl;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "agentforge",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/** @type {BrowserWindow | null} */
let mainWindow = null;
let hostReady = false;
let exiting = false;
/** Set by the updater right before quitAndInstall spawns the NSIS installer. */
let installingUpdate = false;

function shouldQuitOnLastWindow() {
  return process.platform !== "darwin";
}

function exitApp() {
  if (exiting) {
    return;
  }
  exiting = true;
  hostReady = false;
  mainWindow = null;
  if (installingUpdate) {
    // quitAndInstall has already spawned the NSIS installer as a detached child of this process.
    // The taskkill /T tree walk below would take the installer down with us, so exit plainly here.
    // Leftover helpers are handled by build/installer.nsh: its customInit inserts killRunningAgentforge,
    // which taskkills any remaining Agentforge.exe tree before setup overwrites files.
    app.exit(0);
    return;
  }
  if (process.platform === "win32") {
    execFile("taskkill", ["/F", "/PID", String(process.pid), "/T"], () => {
      app.exit(0);
    });
    setTimeout(() => app.exit(0), 1500).unref();
    return;
  }
  app.exit(0);
}

function splashPath() {
  return path.join(__dirname, "splash", "index.html");
}

function windowIconPath() {
  const icon = path.join(__dirname, "splash", "icon.ico");
  return fs.existsSync(icon) ? icon : undefined;
}

function rendererIndex() {
  return path.join(process.resourcesPath, "renderer", "index.html");
}

function drizzleDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "drizzle");
  }
  return path.join(__dirname, "..", "..", "packages", "db", "drizzle");
}

async function loadKeytar() {
  try {
    return require("keytar");
  } catch {
    return null;
  }
}

async function wrapKey() {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const existing = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (existing && existing.trim()) {
        return existing.trim();
      }
      const secret = crypto.randomBytes(32).toString("hex");
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, secret);
      return secret;
    } catch (err) {
      console.warn("keytar unavailable, using session wrap key:", err.message);
    }
  }
  return crypto.randomBytes(32).toString("hex");
}

function writeHostStatus(dataDir, extra) {
  const payload = {
    ready: true,
    pid: process.pid,
    dataDir,
    transport: "ipc",
    surface: "desktop",
    productName: PRODUCT_NAME,
    gatewayName: brand.gatewayName,
    gatewayBaseUrl: brand.gatewayBaseUrl,
    ...extra,
  };
  fs.writeFileSync(path.join(dataDir, "host-status.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: PRODUCT_NAME,
    icon: windowIconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: app.isPackaged ? path.join(__dirname, "preload.cjs") : undefined,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  mainWindow.once("ready-to-show", () => {
    if (exiting || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  mainWindow.loadFile(splashPath());
  mainWindow.on("close", () => {
    if (shouldQuitOnLastWindow()) {
      exitApp();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (shouldQuitOnLastWindow()) {
      exitApp();
    }
  });
}

function registerIpc(host) {
  /** @type {Map<string, AbortController>} */
  const streamAborts = new Map();
  ipcMain.on("host:stream-abort", (_event, payload) => {
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
    streamAborts.get(requestId)?.abort();
  });
  ipcMain.handle("host:ping", () => ({ ok: true }));
  ipcMain.handle("host:request", async (event, payload) => {
    const files = Array.isArray(payload.files)
      ? payload.files.map((file) => ({
          field: file.field,
          filename: file.filename,
          mime: file.mime,
          bytes: Uint8Array.from(file.bytes ?? []),
        }))
      : undefined;
    const abort = new AbortController();
    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    if (requestId) {
      streamAborts.set(requestId, abort);
    }
    const result = await host.dispatch({
      method: payload.method,
      path: payload.path,
      query: payload.query ?? {},
      params: {},
      headers: { "x-agentforge-transport": "ipc" },
      body: payload.body,
      files,
      workspaceId: host.readSelectedWorkspaceId() ?? null,
      abortSignal: abort.signal,
    });
    if (result.type === "stream") {
      void (async () => {
        try {
          for await (const chunk of result.events) {
            event.sender.send("host:stream-chunk", { requestId, chunk });
          }
        } catch (error) {
          event.sender.send("host:stream-error", {
            requestId,
            message: error instanceof Error ? error.message : "stream failed",
          });
        } finally {
          streamAborts.delete(requestId);
          event.sender.send("host:stream-end", { requestId });
        }
      })();
      return { type: "stream", status: 200, requestId };
    }
    streamAborts.delete(requestId);
    if (result.type === "bytes") {
      return {
        type: "bytes",
        status: result.status,
        bytes: Array.from(result.bytes),
        contentType: result.contentType,
        filename: result.filename,
      };
    }
    return result;
  });
  ipcMain.handle("host:save-bytes", async (_event, payload) => {
    const save = await dialog.showSaveDialog({ defaultPath: payload.filename });
    if (save.canceled || !save.filePath) {
      return { ok: false };
    }
    fs.writeFileSync(save.filePath, Buffer.from(payload.bytes));
    return { ok: true };
  });
  ipcMain.handle("agentforge:pick-media", async () => {
    const picked = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Media", extensions: ["mp4", "webm", "mov", "png", "jpg", "jpeg", "webp", "gif", "mp3", "wav", "aac", "m4a"] },
      ],
    });
    if (picked.canceled) {
      return [];
    }
    return picked.filePaths ?? [];
  });
}

function registerMediaProtocol(host) {
  protocol.handle("agentforge", async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "media") {
      const mediaId = url.pathname.replace(/^\//, "");
      const result = await host.dispatch({
        method: "GET",
        path: `/api/v1/media/${mediaId}/file`,
        query: {},
        params: {},
        headers: { "x-agentforge-transport": "ipc" },
        workspaceId: host.readSelectedWorkspaceId() ?? null,
      });
      if (result.type === "bytes") {
        return new Response(result.bytes, {
          headers: { "Content-Type": result.contentType, "Cache-Control": "private, max-age=3600" },
        });
      }
      return new Response("Not found", { status: 404 });
    }
    return new Response("Not found", { status: 404 });
  });
}

async function navigateToUi() {
  if (exiting || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (app.isPackaged) {
    await mainWindow.loadFile(rendererIndex());
  } else {
    await mainWindow.loadURL(WEBDEV_URL);
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

async function bootstrapPackaged() {
  const secret = await wrapKey();
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.AGENTFORGE_DATA_DIR = dataDir;
  process.env.AGENTFORGE_SECRETS_KEY = secret;
  process.env.AGENTFORGE_MIGRATIONS_DIR = drizzleDir();
  delete process.env.DATABASE_URL;

  const host = require("./host.cjs");
  registerIpc(host);
  registerMediaProtocol(host);
  const ping = await host.dispatch({
    method: "GET",
    path: "/api/v1/ping",
    query: {},
    params: {},
    headers: {},
    workspaceId: host.readSelectedWorkspaceId() ?? null,
  });
  if (!ping || ping.type !== "json" || ping.status !== 200) {
    throw new Error("host ping failed");
  }
  hostReady = true;
  const settings = host.loadSettings();
  let editFfmpeg = null;
  try {
    const doctor = await host.dispatch({
      method: "GET",
      path: "/api/v1/edit/doctor",
      query: {},
      params: {},
      headers: {},
      workspaceId: host.readSelectedWorkspaceId() ?? null,
    });
    if (doctor?.type === "json" && doctor.body?.ffmpeg) {
      editFfmpeg = doctor.body.ffmpeg;
    }
  } catch {
    // edit doctor optional during boot
  }
  writeHostStatus(dataDir, {
    runtime: settings.openaiApiKey ? "ai" : process.env.AGENTFORGE_RUNTIME || "stub",
    hasOpenai: Boolean(settings.openaiApiKey),
    editFfmpeg,
  });
  await navigateToUi();
}

async function waitForWebdev(attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${WEBDEV_URL}/api/v1/ping`);
      if (response.ok) {
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Local webdev is not running at http://127.0.0.1:3000. Start `pnpm dev` first.");
}

async function bootstrapDev() {
  await waitForWebdev();
  hostReady = true;
  await navigateToUi();
}

function applyProductPaths() {
  app.setName(PRODUCT_NAME);
  app.setPath("userData", path.join(app.getPath("appData"), PRODUCT_NAME));
}

function migrateLegacyScopedUserData() {
  const dest = app.getPath("userData");
  const legacy = path.join(app.getPath("appData"), "@agentforge", "desktop");
  if (!fs.existsSync(legacy)) {
    return;
  }
  if (path.resolve(dest) === path.resolve(legacy)) {
    return;
  }
  const destSqlite = path.join(dest, "agentforge.sqlite");
  const legacySqlite = path.join(legacy, "agentforge.sqlite");
  if (fs.existsSync(destSqlite) || !fs.existsSync(legacySqlite)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(legacy, dest, { recursive: true, force: false });
}

if (process.platform === "win32") {
  app.disableHardwareAcceleration();
}

applyProductPaths();
migrateLegacyScopedUserData();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();
    registerAutoUpdate({
      app,
      ipcMain,
      BrowserWindow,
      productName: PRODUCT_NAME,
      onInstallStart: () => {
        installingUpdate = true;
      },
    });
    try {
      if (app.isPackaged) {
        await bootstrapPackaged();
      } else {
        await bootstrapDev();
      }
    } catch (error) {
      console.error(error);
      if (!exiting && mainWindow && !mainWindow.isDestroyed()) {
        const folder = app.getPath("userData");
        const safe = JSON.stringify(String(folder));
        await mainWindow.webContents.executeJavaScript(
          `document.querySelector('p').textContent = 'Could not start the local app. See the data folder: ' + ${safe};`,
        );
      }
    }

    app.on("activate", () => {
      if (exiting) {
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("before-quit", () => {
    if (shouldQuitOnLastWindow()) {
      exitApp();
    }
  });

  app.on("window-all-closed", () => {
    if (shouldQuitOnLastWindow()) {
      exitApp();
    }
  });
}
