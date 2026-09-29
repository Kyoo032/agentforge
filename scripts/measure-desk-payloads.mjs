#!/usr/bin/env node
/**
 * Harness, never ships. What one read of a running host costs, and whether its gallery rows point at
 * files that exist.
 *
 *   node scripts/measure-desk-payloads.mjs [base-url]      (default http://127.0.0.1:3000)
 *
 * Read-only: GETs only. Reports, per route, the bytes on the wire and the `JSON.parse` time, then the
 * shape checks the 2026-09-29 payload work is held to (docs/internal/unreleased.md):
 *   - `GET /api/v1/settings` carries no `modes` (the model catalogue lives on `/api/v1/models`);
 *   - `GET /api/v1/models` carries the chat list once, as `models`, and `modes` only for the lists that
 *     differ (image, video, audio, other, music, embedding);
 *   - a gallery row whose file answers 404 is marked `fileMissing`.
 * A host that has not been restarted onto that work prints `NOT YET` for each check it still fails.
 * The same numbers without a running host: `npx tsx scripts/measure-desk-payloads-direct.mts`.
 */
const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const CHAT_SHAPED = ["chat", "documents", "research", "presentations", "finance", "data", "market", "legal", "meeting"];
const OWN_LISTS = ["audio", "embedding", "image", "music", "other", "video"];

async function read(path) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  const fetched = performance.now() - started;
  const parseStarted = performance.now();
  const body = JSON.parse(text);
  return {
    status: response.status,
    bytes: Buffer.byteLength(text),
    fetchMs: fetched,
    parseMs: performance.now() - parseStarted,
    body,
  };
}

function line(label, ok) {
  console.log(`${ok ? "ok      " : "NOT YET "} ${label}`);
}

const settings = await read("/api/v1/settings");
const models = await read("/api/v1/models");
console.log(
  `GET /api/v1/settings  ${settings.status}  ${String(settings.bytes).padStart(7)} bytes  parse ${settings.parseMs.toFixed(2)} ms`,
);
console.log(
  `GET /api/v1/models    ${models.status}  ${String(models.bytes).padStart(7)} bytes  parse ${models.parseMs.toFixed(2)} ms`,
);

line("settings has no `modes`", !("modes" in settings.body));
line("settings still has `defaults`", typeof settings.body.defaults === "object" && settings.body.defaults !== null);
const modeKeys = Object.keys(models.body.modes ?? {}).sort();
line(
  `models.modes is only the lists that differ (${modeKeys.join(", ")})`,
  JSON.stringify(modeKeys) === JSON.stringify(OWN_LISTS),
);
line(
  "models.modes repeats no chat-shaped mode",
  CHAT_SHAPED.every((mode) => !(mode in (models.body.modes ?? {}))),
);
const once = JSON.stringify(models.body.models).length;
line(
  `models is barely more than one copy of the chat list (${models.bytes} vs ${once} bytes)`,
  models.bytes < once * 1.5,
);

for (const kind of ["videos", "images", "music"]) {
  const gallery = await read(`/api/v1/${kind}`);
  const items = gallery.body.items ?? [];
  let gone = 0;
  let marked = 0;
  let markedButPresent = 0;
  for (const item of items) {
    const file = await fetch(`${base}${item.url}`, { headers: { range: "bytes=0-0" } });
    await file.arrayBuffer();
    const missing = file.status === 404;
    gone += missing ? 1 : 0;
    marked += item.fileMissing === true ? 1 : 0;
    markedButPresent += item.fileMissing === true && !missing ? 1 : 0;
  }
  console.log(
    `GET /api/v1/${kind.padEnd(6)} ${gallery.status}  ${String(items.length).padStart(3)} rows  file 404: ${gone}  marked fileMissing: ${marked}`,
  );
  line(
    `${kind}: every row whose file is gone is marked, none that exists is`,
    marked === gone && markedButPresent === 0,
  );
}
