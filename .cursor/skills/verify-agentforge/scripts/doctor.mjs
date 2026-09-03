#!/usr/bin/env node
/**
 * Read-only: is this Agentforge instance worth driving?
 * Usage:
 *   node .cursor/skills/verify-agentforge/scripts/doctor.mjs
 *       → local webdev at http://127.0.0.1:3000
 *   node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
 *       → packaged IPC host from Electron userData host-status.json:
 *         Windows: %APPDATA%/Agentforge|Kemenkeu AI|AIHub Metranet/host-status.json
 *                  (legacy: %APPDATA%/@agentforge/desktop/host-status.json)
 *         Linux:   $XDG_CONFIG_HOME/Agentforge/host-status.json
 *                  or ~/.config/Agentforge/host-status.json
 *         macOS:   ~/Library/Application Support/Agentforge/host-status.json
 *   AGENTFORGE_VERIFY_URL=http://127.0.0.1:PORT node …/doctor.mjs
 *       → explicit loopback for **webdev only** (ignored with --desktop)
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { desktopHostStatusCandidates, packagedSqliteHint } from "./desktop-app-url.mjs";

const WEBDEV_URL = "http://127.0.0.1:3000";
const desktopFlag = process.argv.includes("--desktop");

function fail(message, extra) {
  console.error(`verify-agentforge doctor: FAIL — ${message}`);
  if (extra) {
    console.error(extra);
  }
  process.exit(1);
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function portOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return NaN;
  }
}

function desktopStatusPath() {
  const candidates = desktopHostStatusCandidates();
  let newest = "";
  let newestMtime = -1;
  for (const file of candidates) {
    if (!existsSync(file)) {
      continue;
    }
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime >= newestMtime) {
        newest = file;
        newestMtime = mtime;
      }
    } catch {
      // unreadable candidate
    }
  }
  return newest || candidates[0];
}

async function doctorDesktop() {
  const file = desktopStatusPath();
  if (!existsSync(file)) {
    fail(
      `packaged host-status.json missing at ${file}. Launch the installed Agentforge once. Do not doctor :3000 as the desktop app — that is webdev only. Packaged Agentforge has no loopback HTTP server.`,
    );
  }
  let status;
  try {
    status = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`host-status.json at ${file} is not JSON`, String(error));
  }
  if (!status || typeof status !== "object") {
    fail(`host-status.json at ${file} is empty`);
  }
  if (status.transport !== "ipc") {
    fail(
      `host-status.json transport is ${JSON.stringify(status.transport)} (expected "ipc"). This build must not spawn a Next/HTTP child.`,
    );
  }
  if (status.ready !== true) {
    fail(`host-status.json ready is not true at ${file}`);
  }
  const pid = Number(status.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    fail(`host-status.json pid is missing at ${file}`);
  }
  const dataDir = typeof status.dataDir === "string" ? status.dataDir.trim() : "";
  if (!dataDir) {
    fail(`host-status.json dataDir is missing at ${file}`);
  }
  const runtime = status.runtime ?? "(missing)";
  const hasOpenai = Boolean(status.hasOpenai);
  const report = {
    ok: true,
    url: "ipc",
    surface: "desktop",
    chatStatus: "ipc",
    transport: "ipc",
    pid,
    runtime,
    hasOpenai,
    keyFingerprint: false,
    modeKeys: [],
    chatCount: 0,
    curation: false,
    dataDir,
    sqliteHint: packagedSqliteHint(),
    statusFile: file,
  };
  console.log(JSON.stringify(report, null, 2));
  console.log("");
  if (runtime === "stub") {
    console.log("verify-agentforge doctor: OK — packaged IPC host, stub runtime. Safe for Chat send without a live gateway.");
  } else if (runtime === "ai") {
    console.log(
      "verify-agentforge doctor: OK — packaged IPC host, live runtime (a gateway key is saved). Do not treat Chat send or studio generate as stub proof.",
    );
  } else {
    console.log(`verify-agentforge doctor: OK — packaged IPC host, runtime ${runtime}.`);
  }
}

async function get(base, path) {
  const url = `${base}${path}`;
  const started = Date.now();
  const response = await fetch(url, { redirect: "manual" });
  const text = await response.text();
  return { url, status: response.status, ms: Date.now() - started, text };
}

async function doctorWebdev() {
  const fromEnv = process.env.AGENTFORGE_VERIFY_URL?.trim();
  const BASE = (fromEnv || WEBDEV_URL).replace(/\/$/, "");
  const host = hostnameOf(BASE);
  if (host !== "127.0.0.1" && host !== "localhost") {
    fail(`refusing non-loopback URL ${BASE}. Drive loopback only.`);
  }
  if (portOf(BASE) !== 3000 && !fromEnv) {
    fail(`${BASE} is not the local webdev port. Webdev doctor is :3000 only.`);
  }

  let chat;
  let settings;
  try {
    chat = await get(BASE, "/chat");
  } catch (error) {
    fail(`GET ${BASE}/chat did not connect. Start \`pnpm dev\` (local webdev on :3000).`, String(error));
  }

  if (chat.status < 200 || chat.status >= 400) {
    fail(`GET /chat returned ${chat.status}`, chat.text.slice(0, 400));
  }

  try {
    settings = await get(BASE, "/api/v1/settings");
  } catch (error) {
    fail(`GET ${BASE}/api/v1/settings failed`, String(error));
  }

  if (settings.status !== 200) {
    fail(`GET /api/v1/settings returned ${settings.status}`, settings.text.slice(0, 400));
  }

  let payload;
  try {
    payload = JSON.parse(settings.text);
  } catch {
    fail("settings response was not JSON", settings.text.slice(0, 400));
  }

  const runtime = payload.runtime ?? "(missing)";
  const hasOpenai = Boolean(payload.hasOpenai);
  const openaiKeyFingerprint =
    typeof payload.openaiKeyFingerprint === "string" ? payload.openaiKeyFingerprint.trim() : "";
  const keyFingerprint = Boolean(
    hasOpenai && openaiKeyFingerprint.startsWith("sha256:") && openaiKeyFingerprint.length > "sha256:".length,
  );

  let models;
  try {
    models = await get(BASE, "/api/v1/models");
  } catch (error) {
    fail(`GET ${BASE}/api/v1/models failed`, String(error));
  }

  if (models.status !== 200) {
    fail(`GET /api/v1/models returned ${models.status}`, models.text.slice(0, 400));
  }

  let modelsPayload;
  try {
    modelsPayload = JSON.parse(models.text);
  } catch {
    fail("models response was not JSON", models.text.slice(0, 400));
  }

  const modesObj =
    modelsPayload.modes && typeof modelsPayload.modes === "object" && !Array.isArray(modelsPayload.modes)
      ? modelsPayload.modes
      : {};
  const modeKeys = Object.keys(modesObj);
  const modelsList = Array.isArray(modelsPayload.models) ? modelsPayload.models : [];
  const chatCount = modelsList.length;
  const hasTopLevelCuration =
    modelsPayload.curation != null &&
    (typeof modelsPayload.curation === "object" || typeof modelsPayload.curation === "boolean");
  const hasPerModelCuration = modelsList.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      ("bestFor" in entry || "tier" in entry || "curation" in entry),
  );
  const curation = Boolean(hasTopLevelCuration || hasPerModelCuration);

  const report = {
    ok: true,
    url: BASE,
    surface: "webdev",
    chatStatus: chat.status,
    runtime,
    hasOpenai,
    keyFingerprint,
    modeKeys,
    chatCount,
    curation,
    dataDir: process.env.AGENTFORGE_DATA_DIR || "unset (webdev default: <repo>/data)",
    sqliteHint: "data/agentforge.sqlite under AGENTFORGE_DATA_DIR or repo data/",
  };

  console.log(JSON.stringify(report, null, 2));
  console.log("");
  if (runtime === "stub") {
    console.log("verify-agentforge doctor: OK — stub runtime. Safe for Chat send without a live gateway.");
  } else if (runtime === "ai") {
    console.log(
      "verify-agentforge doctor: OK — live runtime (a provider key is saved). Do not treat Chat send or studio generate as stub proof. Settings view and needs-key checks are still valid only when those UI states actually appear.",
    );
  } else {
    console.log(`verify-agentforge doctor: OK — unexpected runtime ${runtime}. Read GET /api/v1/settings before driving.`);
  }
}

if (desktopFlag) {
  await doctorDesktop();
} else {
  await doctorWebdev();
}
