const CDP = process.env.AGENTFORGE_CDP_URL ?? "http://127.0.0.1:9222";
const targets = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page");
if (!page?.webSocketDebuggerUrl) {
  throw new Error("no renderer page");
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}
await send("Runtime.enable");
const probe = await ev(`(() => {
  const text = (sel) => {
    const el = document.querySelector(sel);
    return el ? String(el.textContent || "").trim() : null;
  };
  return {
    href: location.href,
    send: text('[data-testid="composer-send"]'),
    output: text('[data-testid="message-output"]'),
    error: text('[data-testid="chat-error"]') || text('[data-testid="composer-error"]'),
    thinking: text('[data-testid="message-thinking"]'),
    tools: text('[data-testid="message-tools"]') || text('[data-testid="message-tool"]'),
    messages: text('[data-testid="message-list"]'),
    usage: text('[data-testid="chat-usage"]'),
    fingerprint: text('[data-testid="key-fingerprint"]'),
    chatMounted: Boolean(document.querySelector('[data-testid="composer-text"]')),
    settingsMounted: Boolean(document.querySelector('[data-testid="settings-form"]')),
  };
})()`);
console.log(JSON.stringify(probe, null, 2));
ws.close();
