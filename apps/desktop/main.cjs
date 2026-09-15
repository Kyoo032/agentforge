const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require("electron");
const { registerAutoUpdate } = require("./auto-update.cjs");
const { PUBLIC_PRODUCT_NAME } = require("./brand-read.cjs");
const { installApplicationMenu, attachContextMenu } = require("./edit-menu.cjs");
const lifecycle = require("./lifecycle.cjs");
const { RENDERER_CSP } = require("./renderer-csp.cjs");
const {
  isMediaProtocolKey,
  isTrustedSender,
  navigationDecision,
  rendererOrigin,
  safeSaveFilename,
} = require("./navigation.cjs");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// A packaged build that was handed a debugger switch never starts. This process holds the decrypted
// gateway key, the SQLite handle and a preload bridge that dispatches straight into the host, so a
// DevTools endpoint on it is a full read of the user's desk by whatever set our command line — an
// edited shortcut, a "launch with" registration, another program spawning our exe. Debugging belongs
// in webdev, where `app.isPackaged` is false and this never fires.
if (app.isPackaged && lifecycle.hasDebugSwitch(process.argv)) {
  app.exit(1);
}

const DEFAULT_BRAND = {
  productName: "DPSBuddy",
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
    console.warn("brand.json unreadable, using DPSBuddy defaults:", err.message);
    return DEFAULT_BRAND;
  }
}

const brand = loadBrandConfig();
const PRODUCT_NAME = brand.productName;
const KEYCHAIN_SERVICE = PRODUCT_NAME;
const KEYCHAIN_ACCOUNT = "wrap-key";
/** Names the public build carried before the DPSBuddy rename. Read once and copied forward; never deleted here. */
const LEGACY_PUBLIC_NAMES = PRODUCT_NAME === PUBLIC_PRODUCT_NAME ? ["Agentforge"] : [];
const WEBDEV_URL = "http://127.0.0.1:3000";
/** Longest a "Start over" restart waits on `clearRendererState()`; see it for what that covers. */
const CLEAR_STORAGE_TIMEOUT_MS = 3000;
/** Ceiling on a single `host:save-bytes` write. Every real export (a video, a deck, a workbook) fits. */
const MAX_SAVE_BYTES = 200 * 1024 * 1024;
/** What a refused ipc channel answers with, in the shape `IpcHostResponse` already carries. */
const FORBIDDEN_RESPONSE = Object.freeze({ type: "json", status: 403, body: { error: "forbidden" } });
/** Written once per install after `migrateLegacyUserData()` decides; its presence means never again. */
const LEGACY_MIGRATION_MARKER = "legacy-migrated.json";

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
/** The bundled host once bootstrapPackaged() required it; null in dev and before boot. */
let hostModule = null;

function shouldQuitOnLastWindow() {
  return lifecycle.shouldQuitOnLastWindow(process.platform);
}

/**
 * An absolute path to a Windows system binary. Spawning the bare name would let any `taskkill.exe`
 * sitting earlier on PATH — the install directory, a writable folder someone prepended — stand in
 * for the real one and inherit this process's environment. `SystemRoot` is set by the OS on every
 * session; the literal is a floor for a stripped environment, not a normal case.
 *
 * @param {string} name
 * @returns {string}
 */
function windowsSystemBinary(name) {
  const root = process.env.SystemRoot || process.env.windir || String.raw`C:\Windows`;
  return path.join(root, "System32", name);
}

/**
 * Signal every helper the host spawned (ffmpeg / ffprobe). Windows does not need this because
 * exitApp() walks the process tree with taskkill; macOS and Linux have no such walk.
 */
function terminateHostChildren() {
  if (!hostModule || typeof hostModule.killTrackedChildren !== "function") {
    return;
  }
  try {
    const stopped = hostModule.killTrackedChildren();
    if (stopped > 0) {
      console.info(`stopped ${stopped} helper process(es) on quit`);
    }
  } catch (err) {
    console.warn("could not stop helper processes:", err.message);
  }
}

function exitApp() {
  if (exiting) {
    return;
  }
  exiting = true;
  hostReady = false;
  mainWindow = null;
  const strategy = lifecycle.exitStrategy({ platform: process.platform, installingUpdate });
  if (strategy === "plain") {
    // quitAndInstall has already spawned the NSIS installer as a detached child of this process.
    // The taskkill /T tree walk below would take the installer down with us, so exit plainly here.
    // Leftover helpers are handled by build/installer.nsh: its customInit inserts killRunningApp,
    // which taskkills any remaining app exe tree (DPSBuddy.exe, legacy Agentforge.exe) before setup overwrites files.
    app.exit(0);
    return;
  }
  if (strategy === "taskkill-tree") {
    execFile(windowsSystemBinary("taskkill.exe"), ["/F", "/PID", String(process.pid), "/T"], () => {
      app.exit(0);
    });
    setTimeout(() => app.exit(0), 1500).unref();
    return;
  }
  terminateHostChildren();
  app.exit(0);
}

/**
 * Drop everything Chromium is holding for the renderer, in one pass.
 *
 * `clearStorageData()` covers localStorage, IndexedDB, service workers and cookies and nothing else,
 * so on its own it left the HTTP cache, the cached HTTP auth and the compiled code caches in place —
 * a "Start over" restarted onto a window still serving the previous install's bytes and credentials.
 * All four are cleared here.
 *
 * `allSettled`, never `all`: one clear that rejects (a locked cache file, a session torn down under
 * us) must not strand the other three or turn a restart into a stuck window.
 *
 * @returns {Promise<void>}
 */
async function clearRendererState() {
  const results = await Promise.allSettled([
    session.defaultSession.clearStorageData(),
    session.defaultSession.clearCache(),
    session.defaultSession.clearAuthCache(),
    session.defaultSession.clearCodeCaches({}),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn("one renderer clear failed before relaunch:", result.reason?.message ?? result.reason);
    }
  }
}

/**
 * Restart the app for the renderer (Settings -> Start over, and any future restart button).
 *
 * `reset` only concerns what Chromium holds for the renderer — `clearRendererState()` lists it.
 * App-owned files (`agentforge.sqlite`, `settings.enc`, `media/`) are listed by the host in
 * `reset-pending.json` and removed on the next boot before SQLite opens; this shell never deletes
 * them itself.
 *
 * Exit is `app.relaunch()` + `app.exit(0)`, never `exitApp()`: that would run the Windows
 * `taskkill /F /PID <pid> /T` tree walk, and Electron's relauncher is a detached child of this
 * process, so the walk would kill the thing that is meant to start us again. The relauncher waits
 * for this process to exit before spawning the new one, so the single-instance lock taken at module
 * load is already released when the new instance calls `requestSingleInstanceLock()`.
 *
 * @param {boolean} reset
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
async function relaunchApp(reset) {
  const plan = lifecycle.relaunchPlan({ platform: process.platform, installingUpdate, exiting });
  if (!plan.ok) {
    console.warn(`relaunch refused: ${plan.reason}`);
    return { ok: false, reason: plan.reason };
  }
  if (reset) {
    // `exiting` is deliberately still false here: the clear is awaited, and a window close or Cmd+Q
    // arriving meanwhile must still take the normal exit path instead of being swallowed as
    // "already exiting" by a relaunch that has not started leaving yet. The 3 s cap keeps a wedged
    // Chromium clear from stranding the user on a window that never restarts; whatever has not
    // finished by then is dropped with the process a moment later anyway.
    try {
      await Promise.race([
        clearRendererState(),
        new Promise((resolve) => setTimeout(resolve, CLEAR_STORAGE_TIMEOUT_MS).unref()),
      ]);
    } catch (err) {
      console.warn("could not clear renderer state before relaunch:", err.message);
    }
  }
  exiting = true;
  hostReady = false;
  if (plan.killChildren) {
    terminateHostChildren();
  }
  app.relaunch();
  app.exit(0);
  return { ok: true };
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

/** Wrap key saved under a pre-rename service name, so an upgraded install can still open its saved gateway key. */
async function readLegacyWrapKey(keytar) {
  for (const service of LEGACY_PUBLIC_NAMES) {
    const legacy = await keytar.getPassword(service, KEYCHAIN_ACCOUNT);
    if (legacy?.trim()) {
      return legacy.trim();
    }
  }
  return null;
}

async function wrapKey() {
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const existing = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (existing && existing.trim()) {
        return existing.trim();
      }
      const secret = (await readLegacyWrapKey(keytar)) ?? crypto.randomBytes(32).toString("hex");
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

/** The one document the window may hold, as `navigation.cjs` compares them. */
function currentRendererOrigin() {
  return rendererOrigin({ packaged: app.isPackaged, rendererIndex: rendererIndex(), webdevUrl: WEBDEV_URL });
}

/** Hand an http(s) address to the user's browser; anything else is dropped on the floor. */
function openExternally(url) {
  void shell.openExternal(url).catch((err) => {
    console.warn("could not open an external link:", err.message);
  });
}

/**
 * Deny by default for both ways a page can leave its document.
 *
 * Model output is full of links (`target="_blank"` anchors in research sources, market tickers, the
 * ffmpeg setup notice). Without these hooks Chromium would answer each one with a *new BrowserWindow*
 * that has no preload and no navigation rules of its own, pointed at an arbitrary remote page. Both
 * handlers send `http(s)` elsewhere to the system browser and refuse everything else.
 *
 * @param {BrowserWindow} window
 */
function hardenNavigation(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (navigationDecision(url, currentRendererOrigin()) === "external") {
      openExternally(url);
    }
    // Never "allow": the app is one window. A same-origin popup would still be a second, unhardened one.
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const decision = navigationDecision(url, currentRendererOrigin());
    if (decision === "allow") {
      return;
    }
    event.preventDefault();
    if (decision === "external") {
      openExternally(url);
    }
  });
}

/**
 * Serve `RENDERER_CSP` as a response header, alongside the `<meta>` tag `scripts/stage-renderer.mjs`
 * bakes into the packaged index.html. renderer-csp.cjs explains the policy and why it is enforced in
 * both places; in short, the meta tag is what governs the `file://` document and this covers
 * everything else the session serves.
 *
 * Packaged only: webdev needs Vite's inline preamble, its eval'd HMR client and its websocket back to
 * the dev server, none of which survive this policy.
 */
function installContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const withoutCsp = Object.entries(details.responseHeaders ?? {}).filter(
      ([name]) => name.toLowerCase() !== "content-security-policy",
    );
    callback({
      responseHeaders: { ...Object.fromEntries(withoutCsp), "Content-Security-Policy": [RENDERER_CSP] },
    });
  });
}

function createWindow() {
  // A null application menu drops the Edit roles that back Ctrl/Cmd+V, so users could not paste
  // the API key during onboarding. Keep a real Edit menu; autoHideMenuBar keeps it out of sight.
  installApplicationMenu({ Menu, platform: process.platform, productName: PRODUCT_NAME });
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
  attachContextMenu({ Menu, window: mainWindow });
  hardenNavigation(mainWindow);
  mainWindow.once("ready-to-show", () => {
    if (exiting || !mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  if (lifecycle.reopenTarget({ hostReady }) === "ui") {
    // Dock reopen on macOS after the host booted: the splash would never advance, so load the UI.
    void navigateToUi();
  } else {
    mainWindow.loadFile(splashPath());
  }
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
  // Every channel below is bound to the one frame we control: not a subframe, not a devtools page,
  // not anything a navigation slipped into the window. Each refusal is the channel's own "no" shape,
  // never a throw, so a caller that is simply wrong sees an ordinary answer.
  ipcMain.on("host:stream-abort", (event, payload) => {
    if (!isTrustedSender(event, mainWindow)) {
      return;
    }
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : "";
    streamAborts.get(requestId)?.abort();
  });
  ipcMain.handle("host:ping", () => ({ ok: true }));
  ipcMain.handle("host:request", async (event, payload) => {
    if (!isTrustedSender(event, mainWindow)) {
      console.warn("host request refused: forbidden sender");
      return FORBIDDEN_RESPONSE;
    }
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
  /**
   * Write an export the renderer produced to a file the user picks.
   *
   * The renderer names the file and the model names it for the renderer, so the name is untrusted
   * input that lands in the one part of a save dialog people accept without reading:
   * `safeSaveFilename` cuts it back to a bare, non-device leaf. Nothing here throws — a rejected
   * promise would surface in the renderer as an unhandled error with a main-process path in it.
   */
  ipcMain.handle("host:save-bytes", async (event, payload) => {
    if (!isTrustedSender(event, mainWindow)) {
      console.warn("save refused: forbidden sender");
      return { ok: false, reason: "forbidden" };
    }
    try {
      const filename = safeSaveFilename(payload?.filename);
      if (!filename) {
        return { ok: false, reason: "bad-filename" };
      }
      const raw = payload?.bytes;
      const length = Array.isArray(raw) ? raw.length : (raw?.byteLength ?? 0);
      if (length > MAX_SAVE_BYTES) {
        return { ok: false, reason: "too-large" };
      }
      const save = await dialog.showSaveDialog({ defaultPath: filename });
      if (save.canceled || !save.filePath) {
        return { ok: false, reason: "canceled" };
      }
      fs.writeFileSync(save.filePath, Buffer.from(raw ?? []));
      return { ok: true };
    } catch (err) {
      console.warn("could not save the file the renderer asked for:", err.message);
      return { ok: false, reason: "write-failed" };
    }
  });
  // Destructive and un-undoable: the sender gate matters most here.
  ipcMain.handle("app:relaunch", async (event, payload) => {
    if (!isTrustedSender(event, mainWindow)) {
      console.warn("relaunch refused: forbidden sender");
      return { ok: false, reason: "forbidden" };
    }
    return relaunchApp(Boolean(payload?.reset));
  });
  ipcMain.handle("agentforge:pick-media", async (event) => {
    if (!isTrustedSender(event, mainWindow)) {
      console.warn("media picker refused: forbidden sender");
      return [];
    }
    const picked = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Media",
          extensions: ["mp4", "webm", "mov", "png", "jpg", "jpeg", "webp", "gif", "mp3", "wav", "aac", "m4a"],
        },
      ],
    });
    if (picked.canceled) {
      return [];
    }
    return picked.filePaths ?? [];
  });
}

/**
 * Host GET paths served behind the agentforge:// scheme, by hostname. `media` is the user's own
 * gallery; `video-example` is a bundled clip from resources/examples/videos. Both are local bytes.
 */
const PROTOCOL_HOST_PATHS = Object.freeze({
  media: (id) => `/api/v1/media/${id}/file`,
  "video-example": (name) => `/api/v1/videos/examples/${name}/file`,
});

function registerMediaProtocol(host) {
  protocol.handle("agentforge", async (request) => {
    const url = new URL(request.url);
    const toHostPath = PROTOCOL_HOST_PATHS[url.hostname];
    if (!toHostPath) {
      return new Response("Not found", { status: 404 });
    }
    // The hostname above chose the route; the path is the only free part, so it is the only place a
    // traversal or a query string could bend `/api/v1/media/<key>/file` into another host endpoint.
    const key = url.pathname.replace(/^\//, "");
    if (!isMediaProtocolKey(key)) {
      return new Response("Not found", { status: 404 });
    }
    const result = await host.dispatch({
      method: "GET",
      path: toHostPath(key),
      query: {},
      params: {},
      headers: { "x-agentforge-transport": "ipc", range: request.headers.get("range") ?? undefined },
      workspaceId: host.readSelectedWorkspaceId() ?? null,
    });
    if (result.type === "bytes") {
      return new Response(result.bytes, {
        status: result.status,
        headers: {
          "Content-Type": result.contentType,
          "Cache-Control": "private, max-age=3600",
          ...(result.headers ?? {}),
        },
      });
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
  // The only place the packaged app applies `reset-pending.json`. `packages/db` deletes the queued
  // files before SQLite opens, and only when this flag is "1", so no webdev run, test harness, or
  // stray import of the host can ever act on a wipe the user queued in the desktop app.
  process.env.AGENTFORGE_APPLY_PENDING_RESET = "1";

  const host = require("./host.cjs");
  hostModule = host;
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
  // Settings live per desk, and nothing has named one yet: ping and edit/doctor resolve no tenant, so
  // on a fresh install `workspace-id.txt` does not exist and a bare read would land on the empty
  // `__default__` slice. GET /api/v1/context resolves the tenant (which stamps the file) and the read
  // below then names that desk, so the status file reports the runtime the app will actually use.
  try {
    await host.dispatch({
      method: "GET",
      path: "/api/v1/context",
      query: {},
      params: {},
      headers: {},
      workspaceId: host.readSelectedWorkspaceId() ?? null,
    });
  } catch {
    // desk resolution is best effort; the read below still names whatever selection exists
  }
  const settings = host.loadSettings(host.readSelectedWorkspaceId() ?? undefined);
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
    ...lifecycle.hostStatusRuntime({
      hasOpenai: Boolean(settings.openaiApiKey),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    }),
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

/** Older data folders, oldest first: the pre-0.14 scoped folder, then the pre-rename product folder. */
function legacyUserDataDirs() {
  const appData = app.getPath("appData");
  return [path.join(appData, "@agentforge", "desktop"), ...LEGACY_PUBLIC_NAMES.map((name) => path.join(appData, name))];
}

/** Record that the legacy question has been asked, so no later launch can ask it again. */
function writeLegacyMigrationMarker(dest, from) {
  try {
    fs.mkdirSync(dest, { recursive: true });
    const payload = { version: 1, at: new Date().toISOString(), from: from ?? null };
    fs.writeFileSync(path.join(dest, LEGACY_MIGRATION_MARKER), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (err) {
    console.warn("could not record the legacy migration marker:", err.message);
  }
}

/**
 * First launch after an upgrade copies the newest legacy desk into the current userData; nothing is
 * deleted, and the decision is taken exactly once per install.
 *
 * The one-shot marker is the whole point. "userData has no `agentforge.sqlite`" is also the state a
 * "Reset to a fresh install" leaves behind, so without the marker the second launch after a reset
 * would copy the forgotten gateway key, every thread and all media back out of the old desk. The
 * marker is written after any decision, including "nothing to copy".
 */
function migrateLegacyUserData() {
  const dest = app.getPath("userData");
  const markerExists = fs.existsSync(path.join(dest, LEGACY_MIGRATION_MARKER));
  const destHasDb = fs.existsSync(path.join(dest, "agentforge.sqlite"));
  const legacyDirs = markerExists
    ? []
    : legacyUserDataDirs().filter(
        (dir) => path.resolve(dir) !== path.resolve(dest) && fs.existsSync(path.join(dir, "agentforge.sqlite")),
      );
  const plan = lifecycle.legacyMigrationPlan({ markerExists, destHasDb, legacyDirs });
  if (plan === "skip") {
    return;
  }
  if (plan === "mark-only") {
    writeLegacyMigrationMarker(dest, null);
    return;
  }
  const source = legacyDirs.at(-1);
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(source, dest, { recursive: true, force: false });
  writeLegacyMigrationMarker(dest, source);
}

if (process.platform === "win32") {
  app.disableHardwareAcceleration();
}

applyProductPaths();
migrateLegacyUserData();

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
    if (app.isPackaged) {
      installContentSecurityPolicy();
    }
    createWindow();
    // Registered before boot so a Dock click during a slow start still gets a window (macOS only
    // emits this; on Windows/Linux the app has exited by the time all windows are gone).
    app.on("activate", () => {
      if (exiting) {
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    registerAutoUpdate({
      app,
      ipcMain,
      BrowserWindow,
      productName: PRODUCT_NAME,
      platform: process.platform,
      // Read at call time, not captured: createWindow() replaces the window on a macOS Dock reopen.
      getMainWindow: () => mainWindow,
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
  });

  app.on("before-quit", () => {
    if (shouldQuitOnLastWindow()) {
      exitApp();
      return;
    }
    // macOS: Cmd+Q (the `quit` role) is the only exit. Nothing walks the process tree here, so stop
    // the host's helpers before Electron tears the process down, and refuse new windows meanwhile.
    exiting = true;
    hostReady = false;
    if (lifecycle.quitKillsChildren(process.platform)) {
      terminateHostChildren();
    }
  });

  app.on("window-all-closed", () => {
    if (shouldQuitOnLastWindow()) {
      exitApp();
    }
  });
}
