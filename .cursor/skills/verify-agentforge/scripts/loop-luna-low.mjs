import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "0.14", "loop");
const PROMPT = `VERIFY lunalow ${Date.now()}: reply with exactly the word pong`;

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
  const effort = document.querySelector('[data-testid="reasoning-effort"]');
  return {
    href: location.href,
    send: text('[data-testid="composer-send"]'),
    picker: text('[data-testid="model-picker"]'),
    effort: effort && "value" in effort ? String(effort.value) : null,
    output: text('[data-testid="message-output"]'),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    messages: text('[data-testid="message-list"]'),
    usage: text('[data-testid="chat-usage"]'),
  };
})()`;

await send("Runtime.enable");
await send("Page.enable");
mkdirSync(EVIDENCE, { recursive: true });

let idle = await ev(probeExpr);
for (let i = 0; i < 75; i += 1) {
  idle = await ev(probeExpr);
  if (idle.send === "Send") break;
  await sleep(1000);
}

const setEffort = await ev(`(() => {
  const el = document.querySelector('[data-testid="reasoning-effort"]');
  if (!el) return { ok: false };
  el.value = "low";
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: el.value };
})()`);

await ev(`(() => { document.querySelector('[data-testid="new-chat"]')?.click(); return true; })()`);
await sleep(800);

const sent = await ev(`(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  if (!el) return { ok: false };
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(PROMPT)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('[data-testid="composer-send"]')?.click();
  return { ok: true, effort: document.querySelector('[data-testid="reasoning-effort"]')?.value };
})()`);

await shot("06-luna-low-sent.png");
let settled = await ev(probeExpr);
for (let i = 0; i < 50; i += 1) {
  settled = await ev(probeExpr);
  if (settled.output || settled.error || (settled.send === "Send" && String(settled.messages ?? "").includes("VERIFY lunalow"))) {
    break;
  }
  await sleep(1000);
}
await shot("07-luna-low-settled.png");

const report = { idle, setEffort, sent, settled, ok: Boolean(settled.output) && settled.send === "Send" };
writeFileSync(join(EVIDENCE, "lunalow.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
process.exit(report.ok ? 0 : 2);
