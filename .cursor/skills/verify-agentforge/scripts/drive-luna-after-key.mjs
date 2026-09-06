import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CDP = "http://127.0.0.1:9222";
const EVIDENCE = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "0.14", "loop");
const PROMPT = `VERIFY luna-after-key ${Date.now()}: reply with exactly the word pong`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page");
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
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
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
    output: [...document.querySelectorAll('[data-testid="message-output"]')].map((el) => el.textContent).join(" | "),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    usage: text('[data-testid="chat-usage"]'),
  };
})()`;

await send("Runtime.enable");
await send("Page.enable");
mkdirSync(EVIDENCE, { recursive: true });

const picked = await ev(
  `(async () => {
    document.querySelector('[data-testid="mode-chat"]')?.click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('[data-testid="new-chat"]')?.click();
    await new Promise((r) => setTimeout(r, 600));
    const trigger = document.querySelector('[data-testid="model-picker"]');
    if (trigger?.getAttribute("aria-expanded") !== "true") trigger?.click();
    await new Promise((r) => setTimeout(r, 700));
    const luna = [...document.querySelectorAll('[role="option"]')].find((el) =>
      /GPT 5\\.6 Luna|gpt-5\\.6-luna/i.test(el.textContent || ""),
    );
    if (!luna) {
      return { ok: false, options: [...document.querySelectorAll('[role="option"]')].length };
    }
    luna.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    luna.click();
    await new Promise((r) => setTimeout(r, 500));
    return { ok: true, picker: document.querySelector('[data-testid="model-picker"]')?.textContent };
  })()`,
  true,
);

const sent = await ev(`(() => {
  const el = document.querySelector('[data-testid="composer-text"]');
  el.focus();
  const desc = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  desc.set.call(el, ${JSON.stringify(PROMPT)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector('[data-testid="composer-send"]')?.click();
  return { ok: true };
})()`);
await shot("14-luna-sent.png");

let settled = await ev(probeExpr);
const started = Date.now();
for (let i = 0; i < 20; i += 1) {
  settled = await ev(probeExpr);
  if (settled.error || (settled.send === "Send" && /pong|quota|access|403/i.test(String(settled.output || settled.error || "")))) {
    break;
  }
  await sleep(1000);
}
await shot("15-luna-settled.png");

const report = {
  picked,
  sent,
  settled,
  waitedMs: Date.now() - started,
  ok: Boolean(settled.error) || /pong/i.test(String(settled.output || "")),
};
writeFileSync(join(EVIDENCE, "luna-after-key.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
ws.close();
process.exit(0);
