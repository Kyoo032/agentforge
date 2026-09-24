/**
 * Host vitest isolation — runs in every worker before any test module is imported.
 *
 * Without this the suite reads the operator's real desk (`data/agentforge.sqlite`,
 * `data/settings.enc`). Once a real gateway key is saved there `resolveRuntimeMode()`
 * returns "ai" for every handler (a stored key outranks AGENTFORGE_RUNTIME), so
 * `AGENTFORGE_RUNTIME=stub` is inert and tests that expect the stub path make real,
 * billed gateway calls. Everything downstream resolves the desk lazily through
 * `localDataDir()` / `mediaRoot()`, so pointing the env at a throwaway directory here
 * is enough — nothing caches the path at import time.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOST_TEST_ROOT = process.env.AGENTFORGE_HOST_TEST_ROOT?.trim() || join(tmpdir(), "agentforge-host-vitest");

/**
 * One desk per worker: workers run test files in parallel and must not share a sqlite file.
 *
 * mkdtemp, not the pid alone. Every test file gets a fresh worker process, and Windows hands a
 * finished process's pid to a new one: 13 of 226 short-lived children reused a pid on this desk. A
 * `worker-<pid>` name would give that file the earlier file's desk — its database, its saved gateway
 * key — which is exactly what a case like "the gate is really closed" must not start from.
 */
mkdirSync(HOST_TEST_ROOT, { recursive: true });
const dataDir = mkdtempSync(join(HOST_TEST_ROOT, `worker-${process.pid}-`));
const mediaDir = join(dataDir, "media");

mkdirSync(mediaDir, { recursive: true });

// `localDataDir()` prefers AGENTFORGE_SETTINGS_PATH over AGENTFORGE_DATA_DIR, so an
// operator shell that exports it would still point the suite at the real desk.
delete process.env.AGENTFORGE_SETTINGS_PATH;
// `sqliteFilePath()` prefers DATABASE_URL over the data dir, and rejects postgres URLs outright.
delete process.env.DATABASE_URL;
// A real key in the operator's environment is the other way "stub" turns into a live call.
delete process.env.AGENTFORGE_SECRETS_KEY;

process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = mediaDir;
// Baseline only — a test that wants the live path still sets AGENTFORGE_RUNTIME itself.
process.env.AGENTFORGE_RUNTIME = "stub";

/**
 * Proof, not just prevention: a unit test that reaches the public internet is a bug in
 * the test, so fail it loudly instead of paying for it. Loopback stays open because
 * http-adapter / media-download / still-source tests drive real local servers, and a
 * test that stubs `fetch` itself replaces this wrapper for its own scope.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);
const realFetch = globalThis.fetch;

if (typeof realFetch === "function") {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let host: string | null = null;
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") {
        host = url.hostname;
      }
    } catch {
      host = null; // relative / data: / file: — nothing leaves the machine.
    }
    if (host !== null && !LOOPBACK.has(host)) {
      throw new Error(
        `Host vitest tried to reach ${host} (${raw}). Unit tests must not call out; stub the runtime or mock fetch.`,
      );
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
}
