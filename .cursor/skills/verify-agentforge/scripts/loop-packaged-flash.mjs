import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "0.14", "loop");
const PROMPT = `VERIFY flashloop ${Date.now()}: reply with exactly the word pong`;

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
async function ev(expression, awaitPromise = false) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "eval");
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

let before = await ev(probeExpr);
const waitedForIdle = [];
for (let i = 0; i < 90; i += 1) {
  before = await ev(probeExpr);
  waitedForIdle.push({ t: i, send: before.send, error: before.error, output: before.output });
  if (before.send === "Send") break;
  await sleep(1000);
}
await shot("03-after-wait.png");

await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(400);
await ev(`(() => { document.querySelector('[data-testid="new-chat"]')?.click(); return true; })()`);
await sleep(800);

const picked = await ev(`(async () => {
  const trigger = document.querySelector('[data-testid="model-picker"]');
  if (!trigger) return { ok: false, reason: "no picker" };
  trigger.click();
  await new Promise((r) => setTimeout(r, 400));
  const search = document.querySelector('input[type="search"]');
  if (search) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    desc.set.call(search, "flash");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
  }
  const options = [...document.querySelectorAll('[role="option"]')];
  const flash = options.find((el) => /deepseek/i.test(el.textContent || "") && /flash/i.test(el.textContent || ""))
    || options.find((el) => /flash/i.test(el.textContent || ""));
  if (!flash) return { ok: false, reason: "no flash", options: options.map((el) => el.textContent) };
  flash.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 200));
  return { ok: true, picker: document.querySelector('[data-testid="model-picker"]')?.textContent };
})()`, true);

const filled = await ev(`(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return { ok: false };
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(PROMPT)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('[data-testid="composer-send"]')?.click();
  return { ok: true };
})()`);

await sleep(800);
const afterSend = await ev(probeExpr);
await shot("04-flash-sent.png");

let settled = afterSend;
for (let i = 0; i < 45; i += 1) {
  settled = await ev(probeExpr);
  if (settled.output || settled.error || (settled.send === "Send" && String(settled.messages ?? "").includes("VERIFY flashloop"))) {
    break;
  }
  await sleep(1000);
}
await shot("05-flash-settled.png");

const report = {
  before,
  idleCleared: before.send === "Send",
  waitedSeconds: waitedForIdle.length,
  lastIdle: waitedForIdle.at(-1),
  picked,
  filled,
  afterSend,
  settled,
  ok: Boolean(settled.output) && settled.send === "Send",
};
writeFileSync(join(EVIDENCE, "flashloop.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
process.exit(report.ok ? 0 : 2);
