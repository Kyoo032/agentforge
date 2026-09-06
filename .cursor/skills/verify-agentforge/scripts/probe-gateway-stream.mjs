/**
 * Isolates whether Toko Token streams for the packaged key.
 * Never prints the key, wrap secret, or Authorization header.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const DATA_DIR = process.env.APPDATA
  ? join(process.env.APPDATA, "Agentforge")
  : join(process.env.HOME || "", ".config", "Agentforge");
const SETTINGS = join(DATA_DIR, "settings.enc");
const TIMEOUT_MS = 12_000;
const BASE = "https://api.tokotokenai.com/v1";

function wrappingKeyFromSecret(secret) {
  return createHash("sha256").update(secret, "utf8").digest();
}

function decryptJson(envelope, key) {
  const iv = Buffer.from(envelope.n, "base64");
  const ct = Buffer.from(envelope.ct, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function redact(text) {
  return String(text || "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 180);
}

async function timedFetch(url, init) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: ac.signal });
    const reader = response.body?.getReader();
    let firstChunkMs = null;
    let bytes = 0;
    let preview = "";
    if (reader) {
      const first = await reader.read();
      firstChunkMs = Date.now() - started;
      if (!first.done && first.value) {
        bytes = first.value.byteLength;
        preview = redact(Buffer.from(first.value).toString("utf8"));
      }
      await reader.cancel().catch(() => undefined);
    }
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      firstChunkMs,
      bytes,
      preview,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveKey() {
  const fromEnv = process.env.AGENTFORGE_PROBE_KEY?.trim();
  if (fromEnv) {
    return { key: fromEnv, source: "env" };
  }
  const keytar = require("../../../../apps/desktop/node_modules/keytar");
  const wrap = await keytar.getPassword("Agentforge", "wrap-key");
  if (!wrap) {
    throw new Error("no wrap-key in keytar");
  }
  const envelope = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const secrets = decryptJson(envelope, wrappingKeyFromSecret(wrap));
  const key = typeof secrets.openaiApiKey === "string" ? secrets.openaiApiKey.trim() : "";
  if (!key) {
    throw new Error("settings.enc has no openaiApiKey");
  }
  return { key, source: "settings.enc" };
}

const { key, source } = await resolveKey();
const base = BASE;

const headers = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const tool = {
  type: "function",
  function: {
    name: "calculator",
    description: "Evaluate a math expression",
    parameters: {
      type: "object",
      properties: { expression: { type: "string" } },
      required: ["expression"],
    },
  },
};

async function readTextTimed(url, init, ms = 3000) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`text-timeout ${ms}ms`)), ms);
  try {
    const response = await fetch(url, { ...init, signal: ac.signal });
    const text = await response.text();
    return { status: response.status, ms: Date.now() - started, bytes: text.length, preview: redact(text) };
  } catch (error) {
    return { status: 0, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const cases = [
  {
    name: "models",
    url: `${base}/models`,
    init: { method: "GET", headers: { Authorization: `Bearer ${key}` } },
  },
  {
    name: "flash-chat-bare",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        stream: true,
        messages: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    },
  },
  {
    name: "flash-chat-store-false",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        stream: true,
        store: false,
        messages: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    },
  },
  {
    name: "flash-chat-tools",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        stream: true,
        store: false,
        messages: [{ role: "user", content: "Reply with the single word pong" }],
        tools: [tool],
      }),
    },
  },
  {
    name: "luna-responses-bare",
    url: `${base}/responses`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        stream: true,
        store: false,
        input: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    },
  },
  {
    name: "luna-chat-bare",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        stream: true,
        messages: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    },
  },
  {
    name: "minimax-chat-bare",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "MiniMax-M3",
        stream: true,
        messages: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    },
  },
  {
    name: "claude-chat-bare",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "claude-sonnet-5",
        stream: true,
        messages: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    },
  },
  {
    name: "kimi-chat-bare",
    url: `${base}/chat/completions`,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "kimi-k3",
        stream: true,
        messages: [{ role: "user", content: "Reply with the single word pong" }],
      }),
    },
  },
];

const results = [];
for (const item of cases) {
  const result = await timedFetch(item.url, item.init);
  results.push({ name: item.name, ...result });
}

const lunaText = await readTextTimed(`${base}/chat/completions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    model: "gpt-5.6-luna",
    stream: true,
    messages: [{ role: "user", content: "Reply with the single word pong" }],
  }),
});
results.push({ name: "luna-chat-text", ...lunaText });

const summary = {
  ok: results.some((item) => item.ok && item.bytes > 0 && item.status === 200),
  source,
  dataDir: DATA_DIR,
  results,
};
console.log(JSON.stringify(summary, null, 2));
