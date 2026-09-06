import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = process.env.AGENTFORGE_CDP_URL ?? "http://127.0.0.1:9222";
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "0.14", "winapp-cdp");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page");
if (!page?.webSocketDebuggerUrl) throw new Error("no page");
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
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
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
  return {
    href: location.href,
    send: text('[data-testid="composer-send"]'),
    composer: val('[data-testid="composer-text"]'),
    output: text('[data-testid="message-output"]'),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    thinking: text('[data-testid="message-thinking"]'),
    messages: text('[data-testid="message-list"]'),
    usage: text('[data-testid="chat-usage"]'),
    fingerprint: text('[data-testid="key-fingerprint"]'),
    docsStudio: Boolean(document.querySelector('[data-testid="documents-studio-model"], [data-testid="documents-section"]')),
    chatMounted: Boolean(document.querySelector('[data-testid="composer-text"]')),
    settingsMounted: Boolean(document.querySelector('[data-testid="settings-form"]')),
  };
})()`;

await send("Runtime.enable");
await send("Page.enable");
mkdirSync(EVIDENCE, { recursive: true });

await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(800);
const onChat = await ev(probeExpr);
await shot("07-back-to-chat.png");

let waited = onChat;
for (let i = 0; i < 60; i += 1) {
  waited = await ev(probeExpr);
  if (waited.output || waited.error || (waited.send === "Send" && waited.messages && !String(waited.messages).includes("Thinking…"))) {
    break;
  }
  await sleep(1000);
}
await shot("08-wait-reply.png");

const draft = `KEEPALIVE-DRAFT-014-${Date.now()}`;
await ev(`(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return false;
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(draft)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return el.value;
})()`);
await ev(`(() => { document.querySelector('[data-testid="mode-documents"]')?.click(); return true; })()`);
await sleep(1000);
const onDocs = await ev(probeExpr);
await shot("09-documents.png");
await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(1000);
const back = await ev(probeExpr);
await shot("10-keepalive-return.png");

const report = {
  onChat,
  waited,
  draft,
  onDocs,
  back,
  keepaliveHeld: back.composer === draft,
  unstuck: Boolean(waited.output || waited.error || waited.send === "Send"),
};
writeFileSync(join(EVIDENCE, "followup.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
