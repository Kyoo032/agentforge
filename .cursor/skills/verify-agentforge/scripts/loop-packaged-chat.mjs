import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = process.env.AGENTFORGE_CDP_URL ?? "http://127.0.0.1:9222";
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "0.14", "loop");
const PROMPT = `VERIFY loop ${Date.now()}: reply with exactly the word pong`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitJson(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // not up
    }
    await sleep(400);
  }
  throw new Error(`CDP down: ${url}`);
}

const targets = await waitJson(`${CDP}/json/list`);
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "eval failed");
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
    empty: text('[data-testid="chat-empty"]'),
  };
})()`;

await send("Runtime.enable");
await send("Page.enable");
mkdirSync(EVIDENCE, { recursive: true });

for (let i = 0; i < 20; i += 1) {
  const ready = await ev(probeExpr);
  if (ready.modeChat || ready.send || ready.empty) break;
  await sleep(500);
}

await ev(`(() => { document.querySelector('[data-testid="mode-chat"]')?.click(); return true; })()`);
await sleep(600);
await ev(`(() => { document.querySelector('[data-testid="new-chat"]')?.click(); return true; })()`);
await sleep(800);

const picked = await ev(`(() => {
  const trigger = document.querySelector('[data-testid="model-picker"]');
  if (!trigger || trigger.disabled) return { ok: false, reason: "picker disabled or missing", picker: trigger?.textContent };
  trigger.click();
  const search = document.querySelector('input[type="search"]');
  if (search) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    desc.set.call(search, "deepseek-v4-flash");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const options = [...document.querySelectorAll('[role="option"]')];
  const flash = options.find((el) => /flash/i.test(el.textContent || ""))
    || options.find((el) => /deepseek/i.test(el.textContent || ""));
  if (!flash) {
    return { ok: false, reason: "no flash option", options: options.slice(0, 12).map((el) => el.textContent) };
  }
  flash.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  return { ok: true, label: String(flash.textContent || "").trim() };
})()`);
await sleep(400);

const filled = await ev(`(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return { ok: false };
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(PROMPT)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
  const down = new KeyboardEvent("keydown", opts);
  el.dispatchEvent(down);
  return { ok: true, prevented: down.defaultPrevented, value: el.value };
})()`);

const afterEnter = await ev(probeExpr);
await shot("01-after-enter.png");

let settled = afterEnter;
for (let i = 0; i < 40; i += 1) {
  settled = await ev(probeExpr);
  if (settled.output || settled.error || (settled.send === "Send" && String(settled.messages ?? "").includes("VERIFY loop"))) {
    break;
  }
  await sleep(1000);
}
await shot("02-settled.png");

const report = {
  prompt: PROMPT,
  picked,
  filled,
  afterEnter,
  settled,
  ok: Boolean(settled.output) && settled.send === "Send" && !settled.error,
};
writeFileSync(join(EVIDENCE, "loop.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
process.exit(report.ok ? 0 : 2);
