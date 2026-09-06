import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = process.env.AGENTFORGE_CDP_URL ?? "http://127.0.0.1:9222";
const EVIDENCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "evidence",
  "0.14",
  "reverify",
);
const DRAFT = `REVERIFY-KEEPALIVE-${Date.now()}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page");
if (!page?.webSocketDebuggerUrl) {
  throw new Error(`no renderer page: ${JSON.stringify(targets)}`);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("ws failed")));
});
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
function send(method, params = {}) {
  const n = ++id;
  const wait = new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  ws.send(JSON.stringify({ id: n, method, params }));
  return wait;
}
async function ev(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "eval failed");
  }
  return result.result?.value;
}
async function shot(name) {
  const png = await send("Page.captureScreenshot", { format: "png" });
  const file = join(EVIDENCE, name);
  writeFileSync(file, Buffer.from(png.data, "base64"));
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
  const threads = [...document.querySelectorAll('[data-testid="thread-item"]')].map((el) =>
    String(el.textContent || "").trim(),
  );
  return {
    href: location.href,
    title: document.title,
    usage: text('[data-testid="chat-usage"]'),
    context: text('[data-testid="chat-context"]'),
    send: text('[data-testid="composer-send"]'),
    composer: val('[data-testid="composer-text"]'),
    empty: text('[data-testid="chat-empty"]'),
    output: text('[data-testid="message-output"]'),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    thinking: text('[data-testid="message-thinking"]'),
    messages: text('[data-testid="message-list"]'),
    fingerprint: text('[data-testid="key-fingerprint"]'),
    runtime: text('[data-testid="runtime-status"]'),
    usageKey: text('[data-testid="usage-this-key"]'),
    picker: text('[data-testid="model-picker"]'),
    threads,
    modeChat: Boolean(document.querySelector('[data-testid="mode-chat"]')),
    modeDocuments: Boolean(document.querySelector('[data-testid="mode-documents"]')),
    settingsForm: Boolean(document.querySelector('[data-testid="settings-form"]')),
    docsStudio: Boolean(document.querySelector('[data-testid="documents-studio-model"], [data-testid="documents-section"]')),
    chatMounted: Boolean(document.querySelector('[data-testid="composer-text"]')),
  };
})()`;

await send("Runtime.enable");
await send("Page.enable");
mkdirSync(EVIDENCE, { recursive: true });

const startedAt = new Date().toISOString();
await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(1000);
const chatNow = await ev(probeExpr);
await shot("01-chat-now.png");

await ev(`(() => { document.querySelector('[data-testid="settings-link"]')?.click(); return true; })()`);
await sleep(1200);
const settingsNow = await ev(probeExpr);
await shot("02-settings-now.png");

await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(1000);
const backChat = await ev(probeExpr);

const fill = await ev(`(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return { ok: false, reason: "composer-text missing" };
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(DRAFT)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return { ok: true, value: el.value };
})()`);
await ev(`(() => { document.querySelector('[data-testid="mode-documents"]')?.click(); return true; })()`);
await sleep(1200);
const onDocs = await ev(probeExpr);
await shot("03-documents.png");
await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(1200);
const afterRail = await ev(probeExpr);
await shot("04-keepalive-return.png");

const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  pageUrl: page.url,
  chatNow,
  settingsNow,
  backChat,
  fill,
  onDocs,
  afterRail,
  keepaliveHeld: afterRail.composer === DRAFT,
  fingerprintLooksHashed: /^Saved key fingerprint sha256:[0-9a-f]{12}/i.test(
    String(settingsNow.fingerprint ?? ""),
  ),
  sendIsBusy: chatNow.send !== "Send",
  hasAssistantOutput: Boolean(chatNow.output),
  enterThreadPresent: (chatNow.threads ?? []).some((t) => /VERIFY 014-enter/i.test(t)),
  flashThreadPresent: (chatNow.threads ?? []).some((t) => /VERIFY 014-flash/i.test(t)),
};
writeFileSync(join(EVIDENCE, "reverify.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
