const { app, BrowserWindow, Menu } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const LOOPBACK = "127.0.0.1";
/** Local webdev only (`pnpm dev`). Packaged Electron must never bind or reuse this. */
const WEBDEV_PORT = 3000;
const PRODUCT_NAME = "Agentforge";
const KEYCHAIN_SERVICE = PRODUCT_NAME;
const KEYCHAIN_ACCOUNT = "wrap-key";
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** @type {number} */
let appPort = WEBDEV_PORT;
/** @type {string} */
let appUrl = `http://${LOOPBACK}:${WEBDEV_PORT}`;

/** @type {import('node:child_process').ChildProcess | null} */
let webChild = null;
/** @type {boolean} */
let spawnedWeb = false;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {boolean} */
let shuttingDown = false;

function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function packagedWebRoot() {
  return path.join(process.resourcesPath, "web");
}

function packagedNodeBin() {
  const name = process.platform === "win32" ? "node.exe" : "node";
  return path.join(packagedWebRoot(), name);
}

function packagedServerJs() {
  const root = packagedWebRoot();
  const nested = path.join(root, "apps", "web", "server.js");
  const flat = path.join(root, "server.js");
  if (fs.existsSync(nested)) {
    return nested;
  }
  if (fs.existsSync(flat)) {
    return flat;
  }
  return nested;
}

function splashPath() {
  return path.join(__dirname, "splash", "index.html");
}

function randomHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
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
      const secret = randomHex();
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, secret);
      return secret;
    } catch (err) {
      console.warn("keytar unavailable, using session wrap key:", err.message);
    }
  }
  return randomHex();
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: LOOPBACK, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, LOOPBACK, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        server.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          if (!port || port === WEBDEV_PORT) {
            tryOnce();
            return;
          }
          resolve(port);
        });
      });
    };
    tryOnce();
  });
}

async function waitForChatReady(url, port, maxAttempts = 120, intervalMs = 500) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (shuttingDown) {
      return false;
    }
    if (await portOpen(port)) {
      try {
        const response = await fetch(`${url}/chat`, { redirect: "follow" });
        if (response.ok) {
          return true;
        }
      } catch {
        // Next still compiling or serving an error overlay
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function childEnv(secret, dataDir, port) {
  const env = {
    ...process.env,
    AGENTFORGE_SECRETS_KEY: secret,
    AGENTFORGE_DATA_DIR: dataDir,
    HOST: LOOPBACK,
    HOSTNAME: LOOPBACK,
    PORT: String(port),
  };
  delete env.DATABASE_URL;
  return env;
}

function writeAppUrl(dataDir, url) {
  fs.writeFileSync(path.join(dataDir, "app-url.txt"), `${url}\n`, "utf8");
}

function spawnPackagedWeb(secret, dataDir, port) {
  const serverJs = packagedServerJs();
  const nodeBin = packagedNodeBin();

  if (!fs.existsSync(nodeBin)) {
    console.error(`Bundled Node binary missing: ${nodeBin}`);
    throw new Error(`Bundled Node binary missing: ${nodeBin}`);
  }
  if (!fs.existsSync(serverJs)) {
    console.error(`Bundled Next server.js missing: ${serverJs}`);
    throw new Error(`Bundled Next server.js missing: ${serverJs}`);
  }

  const cwd = path.dirname(serverJs);
  const logsDir = path.join(dataDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, "web.log");
  const logFd = fs.openSync(logPath, "a");

  const env = childEnv(secret, dataDir, port);
  env.NODE_ENV = "production";

  const child = spawn(nodeBin, [serverJs], {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: false,
    windowsHide: true,
  });

  child.on("error", (err) => {
    console.error("Failed to spawn bundled Next.js:", err.message);
  });

  child.on("exit", () => {
    try {
      fs.closeSync(logFd);
    } catch {
      // already closed
    }
  });

  return child;
}

function spawnDevWeb(secret, dataDir) {
  const env = childEnv(secret, dataDir, WEBDEV_PORT);
  const child = spawn(PNPM, ["--filter", "@agentforge/web", "dev"], {
    cwd: repoRoot(),
    env,
    stdio: "ignore",
    shell: process.platform === "win32",
    detached: false,
  });

  child.on("error", (err) => {
    console.error("Failed to spawn Next.js:", err.message);
  });

  return child;
}

function spawnWeb(secret, dataDir, port) {
  if (app.isPackaged) {
    return spawnPackagedWeb(secret, dataDir, port);
  }
  return spawnDevWeb(secret, dataDir);
}

function killWebChild() {
  if (!webChild || !spawnedWeb) {
    return;
  }
  const pid = webChild.pid;
  try {
    if (process.platform === "win32" && pid) {
      // Sync: async taskkill returned before the child died, so Agentforge.exe
      // stayed in Task Manager after X and NSIS could not overwrite the install.
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        shell: true,
        timeout: 8000,
        windowsHide: true,
      });
    } else if (webChild) {
      webChild.kill("SIGTERM");
    }
  } catch {
    // best effort
  }
  webChild = null;
  spawnedWeb = false;
}

function beginShutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  killWebChild();
}

async function ensureDataDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Agentforge",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.loadFile(splashPath());

  mainWindow.on("close", () => {
    beginShutdown();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function bumpCompositor(win) {
  if (process.platform !== "win32") {
    return;
  }
  const [width, height] = win.getSize();
  win.setSize(width, height + 1);
  win.setSize(width, height);
}

async function navigateToApp() {
  if (!mainWindow) {
    return;
  }
  await mainWindow.loadURL(appUrl);
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  bumpCompositor(mainWindow);
  mainWindow.focus();
  mainWindow.webContents.focus();
}

async function bootstrap() {
  const secret = await wrapKey();
  const dataDir = app.getPath("userData");
  await ensureDataDir(dataDir);

  if (app.isPackaged) {
    appPort = await allocateLoopbackPort();
    appUrl = `http://${LOOPBACK}:${appPort}`;
    writeAppUrl(dataDir, appUrl);
    try {
      webChild = spawnWeb(secret, dataDir, appPort);
      spawnedWeb = true;
    } catch (err) {
      console.error(`Could not spawn bundled Next.js: ${err.message}`);
    }
  } else {
    appPort = WEBDEV_PORT;
    appUrl = `http://${LOOPBACK}:${WEBDEV_PORT}`;
    const alreadyUp = await portOpen(WEBDEV_PORT);
    if (!alreadyUp) {
      try {
        webChild = spawnWeb(secret, dataDir, appPort);
        spawnedWeb = true;
      } catch (err) {
        console.error(`Could not spawn Next.js: ${err.message}. Run \`pnpm dev\` then reopen Agentforge.`);
      }
    }
  }

  const ready = await waitForChatReady(appUrl, appPort);
  if (ready) {
    await navigateToApp();
  } else if (mainWindow) {
    const failHint = app.isPackaged
      ? "The bundled server failed to start. See logs/web.log in the app data folder."
      : "Start Next with `pnpm dev` then reopen Agentforge.";
    mainWindow.webContents.executeJavaScript(
      `document.querySelector('p').textContent = 'Could not reach ${appUrl}. ${failHint}';`,
    );
  }
}

if (process.platform === "win32") {
  app.disableHardwareAcceleration();
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
    await bootstrap();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        void bootstrap();
      }
    });
  });

  app.on("window-all-closed", () => {
    beginShutdown();
    if (process.platform !== "darwin") {
      app.exit(0);
    }
  });

  app.on("before-quit", () => {
    beginShutdown();
  });
}
