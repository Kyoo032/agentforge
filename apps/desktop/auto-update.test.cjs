const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  updatesEnabled,
  describeUpdateError,
  createUpdateLogger,
  resolveUpdateLogPath,
  registerAutoUpdate,
} = require("./auto-update.cjs");

const CURRENT = "0.14.1";
const HEADER_DUMP = '404 Not Found\nHeaders: {"x-github-request-id":"ABCD","content-type":"application/json"}';

// ---------- fakes ----------

function makeApp({ isPackaged = true, logsDir = null } = {}) {
  return {
    getVersion: () => CURRENT,
    isPackaged,
    getPath: (name) => {
      if (logsDir && name === "logs") {
        return logsDir;
      }
      throw new Error(`getPath(${name}) unavailable outside Electron`);
    },
  };
}

function makeIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, ...args) => handlers.get(channel)(...args),
    channels: () => [...handlers.keys()],
  };
}

function makeWindows() {
  const sent = [];
  const win = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  };
  const destroyed = { isDestroyed: () => true, webContents: { send: () => assert.fail("sent to destroyed window") } };
  return { BrowserWindow: { getAllWindows: () => [win, destroyed] }, sent };
}

function makeAutoUpdater({ checkResult = null, checkError = null } = {}) {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    on: (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    emit: (event, ...args) => {
      for (const fn of listeners.get(event) ?? []) {
        fn(...args);
      }
    },
    checkForUpdates: async () => {
      calls.push("checkForUpdates");
      if (checkError) {
        throw checkError;
      }
      return checkResult;
    },
    downloadUpdate: async () => {
      calls.push("downloadUpdate");
    },
    quitAndInstall: (...args) => calls.push(`quitAndInstall(${args.join(",")})`),
  };
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message ?? `${statusCode} Error\nHeaders: {}`), {
    name: "HttpError",
    statusCode,
    code: `HTTP_ERROR_${statusCode}`,
  });
}

function codedError(code, message = "boom") {
  return Object.assign(new Error(message), { code });
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup(options = {}) {
  const ipcMain = makeIpcMain();
  const windows = makeWindows();
  const autoUpdater = makeAutoUpdater(options.updater);
  const installs = [];
  const result = registerAutoUpdate({
    app: makeApp(options.app),
    ipcMain,
    BrowserWindow: windows.BrowserWindow,
    productName: options.productName ?? "Agentforge",
    autoUpdaterOverride: autoUpdater,
    onInstallStart: () => installs.push(autoUpdater.calls.length),
  });
  return { ipcMain, windows, autoUpdater, installs, result };
}

// ---------- updatesEnabled ----------

assert.equal(updatesEnabled("Agentforge", true), true);
assert.equal(updatesEnabled("Agentforge", false), false);
assert.equal(updatesEnabled("Kemenkeu AI", true), false);
assert.equal(updatesEnabled("AIHub Metranet", true), false);
assert.equal(updatesEnabled(undefined, true), false);

// ---------- describeUpdateError ----------

const NOT_FOUND = "Update feed not found (404). The release repository is unreachable or has no releases.";
assert.equal(describeUpdateError(httpError(404, HEADER_DUMP)), NOT_FOUND);
assert.equal(describeUpdateError({ code: "HTTP_ERROR_404" }), NOT_FOUND);
assert.equal(describeUpdateError(new Error("404 Not Found\nHeaders: {}")), NOT_FOUND);
assert.equal(describeUpdateError(httpError(403)), "GitHub returned 403 while checking for updates.");
assert.equal(describeUpdateError(httpError(500)), "GitHub returned 500 while checking for updates.");
assert.equal(describeUpdateError(httpError(429)), "GitHub returned 429 while checking for updates.");

for (const code of ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]) {
  const text = describeUpdateError(codedError(code, `getaddrinfo ${code} github.com`));
  assert.ok(text.length > 0 && text.length <= 160, `${code} has short text`);
  assert.ok(!text.includes(code), `${code} text is humanized, got: ${text}`);
}

assert.equal(
  describeUpdateError(codedError("ERR_UPDATER_CHANNEL_FILE_NOT_FOUND", "Cannot find channel latest.yml")),
  "The newest release has no latest.yml, so it cannot be installed from here.",
);
assert.equal(
  describeUpdateError(codedError("ERR_UPDATER_LATEST_VERSION_NOT_FOUND", "Unable to find latest version")),
  "No published release was found.",
);
const VERIFY = "The downloaded installer failed verification. Try again.";
assert.equal(describeUpdateError(codedError("ERR_CHECKSUM_MISMATCH", "sha512 checksum mismatch, expected a, got b")), VERIFY);
assert.equal(describeUpdateError(new Error("sha512 checksum mismatch, expected a, got b")), VERIFY);

assert.equal(describeUpdateError(new Error("Something odd\nsecond line with Headers: {}")), "Something odd");
assert.equal(describeUpdateError(new Error("x".repeat(500))).length, 160);
assert.equal(describeUpdateError(new Error("")), "Could not check for updates.");
assert.equal(describeUpdateError(new Error("   \n")), "Could not check for updates.");
assert.equal(describeUpdateError(null), "Could not check for updates.");
assert.equal(describeUpdateError("plain string"), "Could not check for updates.");
assert.equal(describeUpdateError(undefined), "Could not check for updates.");

// ---------- file logger ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentforge-updater-"));
const logFile = path.join(tmp, "nested", "updater.log");
const logger = createUpdateLogger(logFile);
logger.info("hello", { a: 1 });
logger.error(httpError(404, HEADER_DUMP));
const lines = fs.readFileSync(logFile, "utf8").trimEnd().split("\n");
assert.equal(lines.length, 2, "one line per entry even when the message embeds newlines");
assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z info hello \{"a":1\}$/);
assert.match(lines[1], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z error 404 Not Found \| Headers: .*x-github-request-id.* \[code=HTTP_ERROR_404\]$/);
assert.doesNotThrow(() => createUpdateLogger(null).warn("dropped"));
assert.doesNotThrow(() => createUpdateLogger(path.join(logFile, "impossible", "x.log")).error("dropped"));
assert.equal(resolveUpdateLogPath(makeApp()), null);
assert.equal(resolveUpdateLogPath(makeApp({ logsDir: tmp })), path.join(tmp, "updater.log"));

async function main() {
  // ---------- unsupported: flavor product name ----------
  {
    const { ipcMain, result, autoUpdater } = setup({ productName: "Kemenkeu AI" });
    assert.deepEqual(result, { supported: false });
    const state = ipcMain.invoke("updates:state");
    assert.equal(state.supported, false);
    assert.equal(state.status, "unavailable");
    assert.equal(state.currentVersion, CURRENT);
    assert.equal(ipcMain.invoke("updates:check"), state);
    assert.equal(ipcMain.invoke("updates:download"), state);
    assert.throws(() => ipcMain.invoke("updates:install"), /installed Agentforge app/);
    assert.deepEqual(autoUpdater.calls, [], "flavor never touches the updater");
  }

  // ---------- unsupported: not packaged ----------
  {
    const { ipcMain, result, autoUpdater } = setup({ app: { isPackaged: false } });
    assert.deepEqual(result, { supported: false });
    assert.equal(ipcMain.invoke("updates:state").status, "unavailable");
    assert.throws(() => ipcMain.invoke("updates:install"));
    assert.deepEqual(autoUpdater.calls, []);
  }

  // ---------- supported: wiring + error event ----------
  {
    const { ipcMain, windows, autoUpdater, result } = setup({ app: { logsDir: tmp } });
    await settle();
    assert.deepEqual(result, { supported: true });
    assert.equal(autoUpdater.autoDownload, false);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
    assert.equal(typeof autoUpdater.logger.error, "function");
    assert.deepEqual(autoUpdater.calls, ["checkForUpdates"], "startup check runs once");
    assert.equal(ipcMain.invoke("updates:state").status, "idle");

    autoUpdater.emit("error", httpError(404, HEADER_DUMP));
    const state = ipcMain.invoke("updates:state");
    assert.equal(state.status, "error");
    assert.equal(state.message, NOT_FOUND);
    assert.equal(state.supported, true);
    assert.equal(windows.sent.length, 1, "one broadcast per state change, destroyed windows skipped");
    assert.equal(windows.sent[0].channel, "updates:status");
    assert.deepEqual(windows.sent[0].payload, state);

    const onDisk = fs.readFileSync(path.join(tmp, "updater.log"), "utf8");
    assert.match(onDisk, /error updater error: 404 Not Found/);
    assert.match(onDisk, /x-github-request-id/, "raw header dump lands in the log");
    assert.match(onDisk, /HTTP_ERROR_404/);
  }

  // ---------- check: available ----------
  {
    const { ipcMain, windows } = setup({
      updater: { checkResult: { isUpdateAvailable: true, updateInfo: { version: "0.15.0" } } },
    });
    await settle();
    const state = await ipcMain.invoke("updates:check");
    assert.equal(state.status, "available");
    assert.equal(state.version, "0.15.0");
    assert.equal(state.message, undefined);
    assert.equal(windows.sent.at(-1).payload.status, "available");
  }

  // ---------- check: current ----------
  {
    const { ipcMain } = setup({
      updater: { checkResult: { isUpdateAvailable: false, updateInfo: { version: CURRENT } } },
    });
    await settle();
    const state = await ipcMain.invoke("updates:check");
    assert.equal(state.status, "current");
    assert.equal(state.version, undefined);
  }

  // ---------- check: feed older than the install is "current", not a downgrade offer ----------
  {
    const { ipcMain } = setup({
      updater: { checkResult: { isUpdateAvailable: false, updateInfo: { version: "0.13.0" } } },
    });
    await settle();
    const state = await ipcMain.invoke("updates:check");
    assert.equal(state.status, "current");
    assert.equal(state.version, undefined);
  }

  // ---------- check: 404 rejection is returned as state, never rethrown ----------
  {
    const { ipcMain, windows } = setup({ updater: { checkError: httpError(404, HEADER_DUMP) } });
    await settle();
    const state = await ipcMain.invoke("updates:check");
    assert.equal(state.status, "error");
    assert.equal(state.message, NOT_FOUND);
    assert.ok(!state.message.includes("Headers"), "no header dump in UI text");
    assert.ok(!state.message.includes("{"), "no JSON in UI text");
    assert.ok(state.message.length <= 160);
    assert.equal(windows.sent.at(-1).payload.message, NOT_FOUND);
    assert.equal(ipcMain.invoke("updates:state").status, "error");
  }

  // ---------- download: rejection is returned as state ----------
  {
    const { ipcMain, autoUpdater } = setup();
    await settle();
    autoUpdater.downloadUpdate = async () => {
      throw codedError("ECONNRESET", "socket hang up");
    };
    const state = await ipcMain.invoke("updates:download");
    assert.equal(state.status, "error");
    assert.equal(state.message, "The connection to GitHub was interrupted. Try again.");
  }

  // ---------- download: success ----------
  {
    const { ipcMain, autoUpdater } = setup();
    await settle();
    autoUpdater.emit("download-progress", { percent: 42 });
    assert.equal(ipcMain.invoke("updates:state").percent, 42);
    const state = await ipcMain.invoke("updates:download");
    assert.equal(state.status, "ready");
  }

  // ---------- install: onInstallStart runs before quitAndInstall ----------
  {
    const { ipcMain, autoUpdater, installs } = setup();
    await settle();
    const before = ipcMain.invoke("updates:install");
    assert.equal(before.status, "idle", "install without a download is a no-op");
    assert.deepEqual(installs, [], "no install flag when nothing was downloaded");

    autoUpdater.emit("update-downloaded", { version: "0.15.0" });
    assert.equal(ipcMain.invoke("updates:state").status, "ready");
    const after = ipcMain.invoke("updates:install");
    assert.equal(after.status, "ready");
    assert.deepEqual(autoUpdater.calls, ["checkForUpdates", "quitAndInstall(false,true)"]);
    assert.deepEqual(installs, [1], "onInstallStart fired while only the startup check had run");
  }

  // ---------- startup check failure stays quiet ----------
  {
    const { ipcMain } = setup({ updater: { checkError: httpError(404, HEADER_DUMP) } });
    await settle();
    assert.equal(ipcMain.invoke("updates:state").status, "idle", "startup 404 does not surface as an error");
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("auto-update.test.cjs: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
