import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "0.14", "reverify");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page");
if (!page?.webSocketDebuggerUrl) throw new Error("no page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("ws")));
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}
async function shot(name) {
  const png = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(EVIDENCE, name), Buffer.from(png.data, "base64"));
}

const probeExpr = `(() => {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? String(el.textContent || "").trim() : null;
  };
  return {
    href: location.href,
    send: text('[data-testid="composer-send"]'),
    output: text('[data-testid="message-output"]'),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    messages: text('[data-testid="message-list"]'),
    usage: text('[data-testid="chat-usage"]'),
    composer: document.querySelector('[data-testid="composer-text"]')?.value ?? null,
  };
})()`;

await send("Runtime.enable");
await send("Page.enable");
mkdirSync(EVIDENCE, { recursive: true });

await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(800);

const clickedEnter = await ev(`(() => {
  const item = [...document.querySelectorAll('[data-testid="thread-item"]')]
    .find((el) => /VERIFY 014-enter/i.test(el.textContent || ""));
  if (!item) return { ok: false };
  item.click();
  return { ok: true, text: item.textContent };
})()`);
await sleep(1500);
const enterThread = await ev(probeExpr);
await shot("05-enter-thread.png");

const t0 = Date.now();
let waited = enterThread;
for (let i = 0; i < 60; i += 1) {
  waited = await ev(probeExpr);
  if (waited.output || waited.error || waited.send === "Send") break;
  await sleep(1000);
}
const waitedMs = Date.now() - t0;
await shot("06-enter-thread-waited.png");

const clickedFlash = await ev(`(() => {
  const item = [...document.querySelectorAll('[data-testid="thread-item"]')]
    .find((el) => /VERIFY 014-flash/i.test(el.textContent || ""));
  if (!item) return { ok: false };
  item.click();
  return { ok: true };
})()`);
await sleep(1500);
const flashThread = await ev(probeExpr);
await shot("07-flash-thread.png");

const report = {
  clickedEnter,
  enterThread,
  waitedMs,
  waited,
  clickedFlash,
  flashThread,
};
writeFileSync(join(EVIDENCE, "wait.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
