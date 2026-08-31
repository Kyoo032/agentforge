#!/usr/bin/env node
/**
 * Read-only: is this Agentforge instance worth driving?
 * Usage: node .cursor/skills/verify-agentforge/scripts/doctor.mjs
 */
const BASE = (process.env.AGENTFORGE_VERIFY_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

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

async function get(path) {
  const url = `${BASE}${path}`;
  const started = Date.now();
  const response = await fetch(url, { redirect: "manual" });
  const text = await response.text();
  return { url, status: response.status, ms: Date.now() - started, text };
}

const host = hostnameOf(BASE);
if (host !== "127.0.0.1" && host !== "localhost") {
  fail(`refusing non-loopback URL ${BASE}. Bind and drive http://127.0.0.1:3000 only.`);
}

let chat;
let settings;
try {
  chat = await get("/chat");
} catch (error) {
  fail(`GET ${BASE}/chat did not connect. Start the app or reuse the existing 127.0.0.1:3000 process.`, String(error));
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
const report = {
  ok: true,
  url: BASE,
  chatStatus: chat.status,
  runtime,
  hasOpenai,
  dataDir: process.env.AGENTFORGE_DATA_DIR || "unset (product default: <repo>/data)",
  sqliteHint: "data/agentforge.sqlite under AGENTFORGE_DATA_DIR or repo data/",
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
