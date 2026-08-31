const { app, BrowserWindow, Menu } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const LOOPBACK = "127.0.0.1";
const PORT = 3000;
const APP_URL = `http://${LOOPBACK}:${PORT}`;
const KEYCHAIN_SERVICE = "Agentforge";
const KEYCHAIN_ACCOUNT = "wrap-key";
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

/** @type {import('node:child_process').ChildProcess | null} */
let webChild = null;
/** @type {boolean} */
let spawnedWeb = false;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function repoRoot() {
  if (app.isPackaged) {
    return process.cwd();
  }
  return path.resolve(__dirname, "..", "..");
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

function portOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: LOOPBACK, port: PORT }, () => {
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

async function waitForChatReady(maxAttempts = 120, intervalMs = 500) {
  for (let i = 0; i < maxAttempts; i += 1) {
    if (await portOpen()) {
      try {
        const response = await fetch(`${APP_URL}/chat`, { redirect: "follow" });
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

function spawnWeb(secret, dataDir, mode) {
  const root = repoRoot();
  const filterArgs =
    mode === "production"
      ? ["--filter", "@agentforge/web", "start"]
      : ["--filter", "@agentforge/web", "dev"];

  const env = {
    ...process.env,
    AGENTFORGE_SECRETS_KEY: secret,
    AGENTFORGE_DATA_DIR: dataDir,
    HOST: LOOPBACK,
  };
  delete env.DATABASE_URL;

  const child = spawn(PNPM, filterArgs, {
    cwd: root,
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

function killWebChild() {
  if (!webChild || !spawnedWeb) {
    return;
  }
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(webChild.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    } else {
      webChild.kill("SIGTERM");
    }
  } catch {
    // best effort
  }
  webChild = null;
  spawnedWeb = false;
}

async function ensureDataDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function ensureSchema(dataDir) {
  const env = {
    ...process.env,
    AGENTFORGE_DATA_DIR: dataDir,
  };
  delete env.DATABASE_URL;
  const result = spawnSync(
    PNPM,
    ["--filter", "@agentforge/db", "exec", "drizzle-kit", "push", "--force"],
    {
      cwd: repoRoot(),
      env,
      stdio: "pipe",
      shell: process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").toString().trim();
    console.warn("SQLite schema push failed:", detail || `exit ${result.status}`);
  }
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
  await mainWindow.loadURL(APP_URL);
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

  const alreadyUp = await portOpen();
  if (!alreadyUp) {
    ensureSchema(dataDir);
    const mode = app.isPackaged ? "production" : "development";
    try {
      webChild = spawnWeb(secret, dataDir, mode);
      spawnedWeb = true;
    } catch (err) {
      console.error(`Could not spawn Next.js: ${err.message}. Run \`pnpm dev\` then reopen Agentforge.`);
    }
  }

  const ready = await waitForChatReady();
  if (ready) {
    await navigateToApp();
  } else if (mainWindow) {
    mainWindow.webContents.executeJavaScript(
      `document.querySelector('p').textContent = 'Could not reach ${APP_URL}. Start Next with pnpm dev, then reopen Agentforge.';`,
    );
  }
}

if (process.platform === "win32") {
  app.disableHardwareAcceleration();
}

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
    killWebChild();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    killWebChild();
  });
}
