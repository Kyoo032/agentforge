/**
 * Drive the packaged Electron window over Chromium CDP.
 * Prerequisite: DPSBuddy.exe launched with --remote-debugging-port=9222
 * Usage: node .cursor/skills/verify-agentforge/scripts/drive-packaged-cdp.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP_BASE = process.env.AGENTFORGE_CDP_URL ?? "http://127.0.0.1:9222";
const EVIDENCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "evidence",
  "0.14",
  "winapp-cdp",
);
const PROMPT = "VERIFY 014-enter 20260906: What is 2 + 3?";
const DRAFT = "KEEPALIVE-DRAFT-014";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`CDP not reachable at ${url}`);
}

function attachCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) {
        reject(new Error(JSON.stringify(msg.error)));
      } else {
        resolve(msg.result);
      }
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error(`CDP socket failed: ${wsUrl}`)));
  });
  async function send(method, params = {}) {
    await ready;
    const id = ++nextId;
    const wait = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    ws.send(JSON.stringify({ id, method, params }));
    return wait;
  }
  return { send, close: () => ws.close() };
}

async function evaluate(send, expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function screenshot(send, name) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(EVIDENCE, name);
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  return file;
}

const probeExpr = `(() => {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? String(el.textContent || "").trim() : null;
  };
  const val = (sel) => {
    const el = document.querySelector(sel);
    return el && "value" in el ? String(el.value) : null;
  };
  return {
    href: location.href,
    title: document.title,
    usage: text('[data-testid="chat-usage"]'),
    context: text('[data-testid="chat-context"]'),
    send: text('[data-testid="composer-send"]'),
    composer: val('[data-testid="composer-text"]'),
    empty: text('[data-testid="chat-empty"]'),
    messages: text('[data-testid="message-list"]'),
    output: text('[data-testid="message-output"]'),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    fingerprint: text('[data-testid="key-fingerprint"]'),
    runtime: text('[data-testid="runtime-status"]'),
    usageKey: text('[data-testid="usage-this-key"]'),
    settingsForm: Boolean(document.querySelector('[data-testid="settings-form"]')),
    modeChat: Boolean(document.querySelector('[data-testid="mode-chat"]')),
    modeDocuments: Boolean(document.querySelector('[data-testid="mode-documents"]')),
  };
})()`;

const fillExpr = (value) => `(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return { ok: false, reason: "composer-text missing" };
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return { ok: true, value: el.value };
})()`;

const clickExpr = (testid) => `(() => {
  const el = document.querySelector('[data-testid=${JSON.stringify(testid)}]');
  if (!el) return { ok: false, reason: ${JSON.stringify(testid)} + " missing" };
  el.click();
  return { ok: true, text: String(el.textContent || "").trim() };
})()`;

const enterExpr = `(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return { ok: false, reason: "composer-text missing" };
  el.focus();
  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  const down = new KeyboardEvent("keydown", opts);
  const submitted = !el.dispatchEvent(down);
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
  return { ok: true, defaultPrevented: down.defaultPrevented || submitted, value: el.value };
})()`;

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const targets = await waitForJson(`${CDP_BASE}/json/list`);
  const page = (Array.isArray(targets) ? targets : []).find(
    (t) => t.type === "page" && !String(t.url ?? "").startsWith("devtools://"),
  );
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`No renderer page on CDP. Targets: ${JSON.stringify(targets)}`);
  }
  const { send, close } = attachCdp(page.webSocketDebuggerUrl);
  await send("Runtime.enable");
  await send("Page.enable");

  const before = await evaluate(send, probeExpr);
  await screenshot(send, "01-chat-open.png");

  const draft = await evaluate(send, fillExpr(DRAFT));
  const toDocs = await evaluate(send, clickExpr("mode-documents"));
  await sleep(800);
  const onDocs = await evaluate(send, probeExpr);
  await screenshot(send, "02-documents.png");
  const toChat = await evaluate(send, clickExpr("mode-chat"));
  await sleep(800);
  const afterRail = await evaluate(send, probeExpr);
  await screenshot(send, "03-chat-keepalive.png");

  await evaluate(send, fillExpr(PROMPT));
  const enter = await evaluate(send, enterExpr);
  let afterEnter = await evaluate(send, probeExpr);
  if (afterEnter.send === "Send" && !String(afterEnter.messages ?? "").includes("VERIFY 014-enter")) {
    await evaluate(send, clickExpr("composer-send"));
    afterEnter = { ...afterEnter, sendClicked: true };
  }
  await screenshot(send, "04-after-enter.png");

  let settled = afterEnter;
  for (let i = 0; i < 45; i += 1) {
    settled = await evaluate(send, probeExpr);
    const busy = settled.send && settled.send !== "Send";
    const hasOut = Boolean(settled.output);
    const hasErr = Boolean(settled.error);
    if (!busy && (hasOut || hasErr || String(settled.messages ?? "").includes("VERIFY 014-enter"))) {
      break;
    }
    await sleep(1000);
  }
  await screenshot(send, "05-reply.png");

  const toSettings = await evaluate(send, clickExpr("settings-link"));
  await sleep(1000);
  const settings = await evaluate(send, probeExpr);
  await screenshot(send, "06-settings.png");

  const report = {
    cdp: CDP_BASE,
    pageUrl: page.url,
    title: page.title,
    before,
    draft,
    toDocs,
    onDocs,
    toChat,
    afterRail,
    enter,
    afterEnter,
    settled,
    toSettings,
    settings,
    keepaliveHeld: afterRail.composer === DRAFT,
    promptInTranscript: String(settled.messages ?? "").includes("VERIFY 014-enter"),
    fingerprintLooksHashed: /^Saved key fingerprint sha256:[0-9a-f]{12}/i.test(String(settings.fingerprint ?? "")),
  };
  writeFileSync(join(EVIDENCE, "drive.json"), `${JSON.stringify(report, null, 2)}\n`);
  close();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
