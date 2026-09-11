import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { addPastedSource, deleteSource, retrieveChunks } from "../../../knowledge";
import { saveSettings } from "../../../settings-store";
import { getExternalId } from "../../backend-store";
import { resetBackendHealthForTests, setWeknoraBackendForTests } from "../../registry";
import { WeKnoraBackend } from "./backend";
import { WeKnoraSupervisor } from "./supervisor";

/**
 * The same ground the fake-server suite covers, against a real WeKnora-lite binary.
 *
 * Skipped unless `AGENTFORGE_WEKNORA_BIN` points at one, because no developer machine has a build
 * until the CI lane (`.github/workflows/weknora-lite.yml`) produces one. When it is set, this is
 * the test that says whether our assumptions about upstream's wire format still hold — the fake
 * server can only ever be as right as the commit it was written against.
 *
 *   AGENTFORGE_WEKNORA_BIN=/path/to/WeKnora-lite npx vitest run src/knowledge/backends/weknora
 */

const BINARY = process.env.AGENTFORGE_WEKNORA_BIN?.trim();
const describeIfBinary = BINARY ? describe : describe.skip;

/** A real sidecar boots SQLite migrations on first run; give it room. */
const BOOT_TIMEOUT_MS = 120_000;

function tenant(): TenantContext {
  return {
    organizationId: "org-weknora-integration",
    workspaceId: `ws-weknora-int-${crypto.randomUUID()}`,
    userId: "user-weknora-integration",
    role: "owner",
  };
}

function token(): string {
  return `zorblatt${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

describeIfBinary("weknora backend against the real sidecar", () => {
  let supervisor: WeKnoraSupervisor;
  let backend: WeKnoraBackend;
  let dataDir: string;
  let settingsDir: string;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "af-weknora-int-data-"));
    settingsDir = mkdtempSync(join(tmpdir(), "af-weknora-int-settings-"));
    for (const key of ["AGENTFORGE_SETTINGS_PATH", "AGENTFORGE_RUNTIME", "AGENTFORGE_WEKNORA_PATH"]) {
      previous[key] = process.env[key];
    }
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_WEKNORA_PATH = BINARY;
    supervisor = new WeKnoraSupervisor({
      binaryPath: BINARY,
      dataDir,
      idleMs: 0,
      readyTimeoutMs: BOOT_TIMEOUT_MS,
    });
    backend = new WeKnoraBackend(supervisor);
    setWeknoraBackendForTests(backend);
    saveSettings({ knowledgeBackend: "weknora" });
    // Fail here, loudly, rather than in every test below.
    await expect(supervisor.baseUrl()).resolves.toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  }, BOOT_TIMEOUT_MS + 30_000);

  afterAll(async () => {
    setWeknoraBackendForTests(null);
    resetBackendHealthForTests();
    await supervisor?.stop();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(settingsDir, { recursive: true, force: true });
  }, 30_000);

  it("bootstraps a tenant, a model row and a knowledge base", async () => {
    await expect(backend.prepare(tenant())).resolves.toMatchObject({ ok: true });
    await expect(backend.health()).resolves.toMatchObject({ ok: true });
  }, 120_000);

  it("indexes a planted fact and retrieves it with our source identity", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Planted notes", `The internal code name is ${planted}.`);
    expect(source.status).toBe("Indexed");
    expect(getExternalId(ctx, source.id)).toBeTruthy();

    // Real ingest is asynchronous (parse -> chunk -> embed), so the fact is polled for, not assumed.
    const hit = await pollForHit(ctx, planted, source.id);
    expect(hit?.sourceId).toBe(source.id);
    expect(hit?.sourceName).toBe("Planted notes");
    expect(hit?.score ?? 0).toBeGreaterThan(0);
  }, 180_000);

  it("forgets a source when it is deleted", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Doomed notes", `The code name is ${planted}.`);
    await pollForHit(ctx, planted, source.id);

    expect(deleteSource(ctx, source.id)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const after = await retrieveChunks(ctx, planted, 4);
    expect(after.chunks.filter((chunk) => chunk.sourceId === source.id)).toHaveLength(0);
  }, 180_000);
});

async function pollForHit(ctx: TenantContext, planted: string, sourceId: string) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = await retrieveChunks(ctx, planted, 4);
    const hit = result.chunks.find((chunk) => chunk.sourceId === sourceId);
    if (hit) {
      return hit;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}
