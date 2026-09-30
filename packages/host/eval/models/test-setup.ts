/**
 * Isolation for the eval tool's unit tests, run before every test module.
 *
 * - The data dir is a throwaway, so nothing here can read the operator's desk (`settings.enc`,
 *   `.master-key`, the model cache).
 * - `fetch` throws. A test that needs one passes its own fake in; a call that reaches this one is a bug
 *   in the test, and the tool must never make a live call from a unit test.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(tmpdir(), "agentforge-eval-models-vitest");
mkdirSync(root, { recursive: true });

delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SECRETS_KEY;
delete process.env.AGENTFORGE_MODELS_CACHE_PATH;
delete process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH;
process.env.AGENTFORGE_DATA_DIR = mkdtempSync(join(root, `worker-${process.pid}-`));
process.env.AGENTFORGE_RUNTIME = "stub";

globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  throw new Error(`eval/models tests must not call out (${new URL(target).host}); pass a fake fetch in.`);
}) as typeof fetch;
