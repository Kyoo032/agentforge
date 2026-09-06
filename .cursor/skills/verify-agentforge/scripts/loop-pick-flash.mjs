const CDP = "http://127.0.0.1:9222";
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

const diag = await ev(`(async () => {
  document.querySelector('[data-testid="mode-chat"]')?.click();
  await new Promise((r) => setTimeout(r, 300));
  const trigger = document.querySelector('[data-testid="model-picker"]');
  const before = {
    disabled: trigger?.disabled ?? null,
    expanded: trigger?.getAttribute("aria-expanded"),
    text: trigger?.textContent,
  };
  trigger?.click();
  await new Promise((r) => setTimeout(r, 600));
  const options = [...document.querySelectorAll('[role="option"]')].map((el) => el.textContent);
  const listbox = Boolean(document.querySelector('[role="listbox"]'));
  const search = Boolean(document.querySelector('input[type="search"]'));
  return { before, afterExpanded: trigger?.getAttribute("aria-expanded"), listbox, search, options };
})()`, true);
console.log(JSON.stringify(diag, null, 2));
ws.close();
