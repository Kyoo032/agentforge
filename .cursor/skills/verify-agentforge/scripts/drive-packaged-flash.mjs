import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = process.env.AGENTFORGE_CDP_URL ?? "http://127.0.0.1:9222";
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "0.14", "winapp-cdp");
const PROMPT = "VERIFY 014-flash 20260906: reply with the single word pong";

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
async function ev(expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "eval failed");
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
  return {
    href: location.href,
    send: text('[data-testid="composer-send"]'),
    picker: text('[data-testid="model-picker"]'),
    output: text('[data-testid="message-output"]'),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    messages: text('[data-testid="message-list"]'),
    usage: text('[data-testid="chat-usage"]'),
  };
})()`;

await send("Runtime.enable");
await send("Page.enable");
mkdirSync(EVIDENCE, { recursive: true });

await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(400);
const newChat = await ev(`(() => {
  const el = document.querySelector('[data-testid="new-chat"]');
  if (!el) return { ok: false };
  el.click();
  return { ok: true };
})()`);
await sleep(800);

const picked = await ev(`(() => {
  const trigger = document.querySelector('[data-testid="model-picker"]');
  if (!trigger) return { ok: false, reason: "picker missing" };
  trigger.click();
  const search = document.querySelector('input[type="search"]');
  if (search) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    desc.set.call(search, "deepseek-v4-flash");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const options = [...document.querySelectorAll('[role="option"]')];
  const flash = options.find((el) => /flash/i.test(el.textContent || ""));
  if (!flash) {
    return { ok: false, reason: "flash option missing", options: options.map((el) => el.textContent) };
  }
  flash.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  flash.click();
  return { ok: true, label: flash.textContent, picker: trigger.textContent };
})()`);
await sleep(400);

await ev(`(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return false;
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(PROMPT)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  return el.value;
})()`);

const afterEnter = await ev(probeExpr);
await shot("11-flash-enter.png");

let settled = afterEnter;
for (let i = 0; i < 50; i += 1) {
  settled = await ev(probeExpr);
  if (settled.output || settled.error || (settled.send === "Send" && String(settled.messages ?? "").includes("VERIFY 014-flash"))) {
    break;
  }
  await sleep(1000);
}
await shot("12-flash-reply.png");

const report = { newChat, picked, afterEnter, settled };
writeFileSync(join(EVIDENCE, "flash.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
