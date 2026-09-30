/**
 * Harness, never ships. Calls the host router's handlers directly (no HTTP, no `:3000`, so no restart is
 * needed to see host changes) on a COPY of a desk's model catalogue, and prints what a read costs:
 * bytes, `JSON.stringify`, `JSON.parse` and `structuredClone` (the two halves of the packaged app's IPC
 * crossing), for `GET /api/v1/settings` and `GET /api/v1/models`, next to the same catalogue in the
 * shape they had before 2026-09-29 (the chat list under nine more mode names).
 *
 *   npx tsx scripts/measure-desk-payloads-direct.mts
 *
 * `SRC_DESK` names the desk to copy `models-cache.json` / `models-dev-cache.json` from (default
 * `.webdev-data-design` in the repo root). Nothing is written to it: the copy goes to a temp dir, which is
 * removed on exit.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = process.env.SRC_DESK ?? join(root, ".webdev-data-design");
const dataDir = mkdtempSync(join(tmpdir(), "measure-desk-payloads-"));
for (const name of ["models-cache.json", "models-dev-cache.json", "models-dev-cache.meta.json"]) {
  if (existsSync(join(source, name))) {
    copyFileSync(join(source, name), join(dataDir, name));
  }
}
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "d".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

const { dispatch } = await import("../packages/host/src/router");

async function get(path: string): Promise<Record<string, unknown>> {
  const result = await dispatch({ method: "GET", path, query: {}, params: {}, headers: {} });
  if (result.type !== "json") {
    throw new Error(`expected json for ${path}`);
  }
  return result.body as Record<string, unknown>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function cost(label: string, body: unknown): void {
  const text = JSON.stringify(body);
  const stringify: number[] = [];
  const parse: number[] = [];
  const clone: number[] = [];
  for (let run = 0; run < 40; run += 1) {
    let started = performance.now();
    JSON.stringify(body);
    stringify.push(performance.now() - started);
    started = performance.now();
    JSON.parse(text);
    parse.push(performance.now() - started);
    started = performance.now();
    structuredClone(body);
    clone.push(performance.now() - started);
  }
  console.log(
    `${label.padEnd(38)} ${String(text.length).padStart(8)} bytes  stringify ${median(stringify).toFixed(3)} ms  parse ${median(parse).toFixed(3)} ms  structuredClone ${median(clone).toFixed(3)} ms`,
  );
}

try {
  // Warm the catalogue memo once so the timings are the payload, not the first build.
  await get("/api/v1/models");
  const settings = await get("/api/v1/settings");
  const models = (await get("/api/v1/models")) as { models: unknown[]; modes: Record<string, unknown[]> };

  console.log(
    "settings has `modes`:",
    "modes" in settings,
    "| models.modes keys:",
    Object.keys(models.modes).join(", "),
  );
  console.log("chat models:", models.models.length);
  cost("GET /api/v1/settings (now)", settings);
  cost("GET /api/v1/models   (now)", models);

  // The old shape, rebuilt from the new one: the chat list under nine more names.
  const chatShaped = [
    "chat",
    "documents",
    "research",
    "presentations",
    "finance",
    "data",
    "market",
    "legal",
    "meeting",
  ];
  const oldModes = { ...models.modes, ...Object.fromEntries(chatShaped.map((mode) => [mode, models.models])) };
  cost("GET /api/v1/settings (before, rebuilt)", { ...settings, modes: oldModes });
  cost("GET /api/v1/models   (before, rebuilt)", { ...models, modes: oldModes });
} finally {
  const { sql } = await import("../packages/db/src/index");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true });
}
