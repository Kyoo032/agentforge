#!/usr/bin/env node
/**
 * Read-only: is this Agentforge instance worth driving?
 * Usage:
 *   node .cursor/skills/verify-agentforge/scripts/doctor.mjs
 *       → local webdev at http://127.0.0.1:3000
 *   node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
 *       → packaged app URL from Electron userData app-url.txt:
 *         Windows: %APPDATA%/Agentforge/app-url.txt
 *                  (legacy: %APPDATA%/@agentforge/desktop/app-url.txt)
 *         Linux:   $XDG_CONFIG_HOME/Agentforge/app-url.txt
 *                  or ~/.config/Agentforge/app-url.txt
 *         macOS:   ~/Library/Application Support/Agentforge/app-url.txt
 *   AGENTFORGE_VERIFY_URL=http://127.0.0.1:PORT node …/doctor.mjs
 *       → explicit loopback (overrides both)
 */
import { readFileSync, existsSync } from "node:fs";
import { desktopAppUrlCandidates, packagedSqliteHint } from "./desktop-app-url.mjs";

const WEBDEV_URL = "http://127.0.0.1:3000";
const desktopFlag = process.argv.includes("--desktop");

function desktopAppUrlPath() {
  const candidates = desktopAppUrlCandidates();
  for (const file of candidates) {
    if (existsSync(file)) {
      return file;
    }
  }
  return candidates[0];
}

function resolveBase() {
  const fromEnv = process.env.AGENTFORGE_VERIFY_URL?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }
  if (desktopFlag) {
    const file = desktopAppUrlPath();
    if (!existsSync(file)) {
      fail(
        `packaged app-url.txt missing at ${file}. Launch the installed Agentforge once, or set AGENTFORGE_VERIFY_URL. Do not doctor :3000 as the desktop app — that is webdev only.`,
      );
    }
    const text = readFileSync(file, "utf8").trim();
    if (!text) {
      fail(`app-url.txt at ${file} is empty`);
    }
    return text.replace(/\/$/, "");
  }
  return WEBDEV_URL;
}

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

const BASE = resolveBase();

async function get(path) {
  const url = `${BASE}${path}`;
  const started = Date.now();
  const response = await fetch(url, { redirect: "manual" });
  const text = await response.text();
  return { url, status: response.status, ms: Date.now() - started, text };
}

const host = hostnameOf(BASE);
if (host !== "127.0.0.1" && host !== "localhost") {
  fail(`refusing non-loopback URL ${BASE}. Drive loopback only.`);
}

if (desktopFlag && portOf(BASE) === 3000) {
  fail(
    `${BASE} is the local webdev port. Packaged Agentforge must not bind 3000. Check app-url.txt after launching the installed app.`,
  );
}

let chat;
let settings;
try {
  chat = await get("/chat");
} catch (error) {
  fail(
    desktopFlag
      ? `GET ${BASE}/chat did not connect. Launch the installed Agentforge (not pnpm dev).`
      : `GET ${BASE}/chat did not connect. Start \`pnpm dev\` (local webdev on :3000).`,
    String(error),
  );
}

if (chat.status < 200 || chat.status >= 400) {
  fail(`GET /chat returned ${chat.status}`, chat.text.slice(0, 400));
}

try {
  settings = await get("/api/v1/settings");
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
  models = await get("/api/v1/models");
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
  surface: desktopFlag ? "desktop" : "webdev",
  chatStatus: chat.status,
  runtime,
  hasOpenai,
  keyFingerprint,
  modeKeys,
  chatCount,
  curation,
  dataDir: process.env.AGENTFORGE_DATA_DIR || "unset (webdev default: <repo>/data; packaged: Electron userData)",
  sqliteHint: desktopFlag
    ? packagedSqliteHint()
    : "data/agentforge.sqlite under AGENTFORGE_DATA_DIR or repo data/",
};

console.log(JSON.stringify(report, null, 2));
console.log("");
if (runtime === "stub") {
  console.log("verify-agentforge doctor: OK — stub runtime. Safe for Chat send without a live gateway.");
} else if (runtime === "ai") {
  console.log(
    "verify-agentforge doctor: OK — live runtime (a provider key or non-default URL is saved). Do not treat Chat send or studio generate as stub proof. Settings view and needs-key checks are still valid only when those UI states actually appear.",
  );
} else {
  console.log(`verify-agentforge doctor: OK — unexpected runtime ${runtime}. Read GET /api/v1/settings before driving.`);
}
