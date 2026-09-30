/**
 * The first-run guide's record: `POST /api/v1/settings/guide` writes it, `GET /api/v1/settings`
 * carries it as `guide`, and it lives in the sealed settings payload beside the language.
 *
 * Real router, real sealed store, throwaway data dir. The one thing this file cannot show is that
 * "Start over" erases it; that needs two processes and lives in `../first-run-modes.test.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";
import type { HostRequest, HostResult } from "../types";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-guide-handler-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_SECRETS_KEY = "b".repeat(64);
// Outside the stub runtime, the way a packaged Personal app runs: no key means a CLOSED gate, which
// is the state the guide must still be recordable in.
delete process.env.AGENTFORGE_RUNTIME;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;
let store: typeof import("../settings-store");

type GuideView = { seen: boolean; outcome: string | null; at: number | null };

/** The parts of an answer these cases read; every other field the host sends is ignored. */
type Answer = {
  guide: GuideView;
  gateway: { allowed: boolean };
  savedLocale: string;
  error: { code: string };
};

async function json(method: string, path: string, body?: unknown): Promise<{ status: number; body: Answer }> {
  const result = await dispatch({ method, path, query: {}, params: {}, headers: {}, body });
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: (result.body ?? {}) as Answer };
}

async function guide(): Promise<GuideView> {
  const answer = await json("GET", "/api/v1/settings");
  expect(answer.status).toBe(200);
  return answer.body.guide;
}

beforeAll(async () => {
  ({ dispatch } = await import("../router"));
  store = await import("../settings-store");
}, ROUTER_IMPORT_BUDGET_MS);

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("the first-run guide record over the wire", () => {
  it("is unseen on a fresh install", async () => {
    expect(await guide()).toEqual({ seen: false, outcome: null, at: null });
  });

  it("records an outcome, answers with it, and GET settings reports it seen", async () => {
    const before = Date.now();
    const recorded = await json("POST", "/api/v1/settings/guide", { outcome: "skipped" });

    expect(recorded.status).toBe(200);
    expect(recorded.body.guide).toMatchObject({ seen: true, outcome: "skipped" });
    expect(recorded.body.guide.at).toBeGreaterThanOrEqual(before);
    expect(await guide()).toEqual(recorded.body.guide);
  });

  it("survives a cold read of the sealed file, not just a warm cache", async () => {
    await json("POST", "/api/v1/settings/guide", { outcome: "closed" });
    store.resetSettingsCacheForTests();

    expect(await guide()).toMatchObject({ seen: true, outcome: "closed" });
  });

  it("accepts finished, skipped and closed, and keeps the latest", async () => {
    for (const outcome of ["finished", "skipped", "closed"]) {
      const answer = await json("POST", "/api/v1/settings/guide", { outcome });
      expect(answer.status).toBe(200);
      expect(answer.body.guide.outcome).toBe(outcome);
    }
    expect((await guide()).outcome).toBe("closed");
  });

  it("refuses anything else with a 400 and leaves the record as it was", async () => {
    await json("POST", "/api/v1/settings/guide", { outcome: "finished" });

    for (const body of [{ outcome: "dismissed" }, { outcome: "" }, { outcome: 1 }, {}, undefined]) {
      const answer = await json("POST", "/api/v1/settings/guide", body);
      expect(answer.status).toBe(400);
      expect(answer.body.error.code).toBe("invalid_request");
    }
    expect((await guide()).outcome).toBe("finished");
  });

  it("works on a desk whose gateway gate is closed: dismissing a tour needs no key", async () => {
    const settings = await json("GET", "/api/v1/settings");
    expect(settings.body.gateway.allowed).toBe(false);

    const answer = await json("POST", "/api/v1/settings/guide", { outcome: "skipped" });

    expect(answer.status).toBe(200);
  });

  it("is not wiped by saving a language, and saving the guide does not change the language", async () => {
    const saved = await json("POST", "/api/v1/settings", { locale: "id" });
    expect(saved.status).toBe(200);
    expect(saved.body.guide.seen).toBe(true);
    expect(saved.body.savedLocale).toBe("id");

    await json("POST", "/api/v1/settings/guide", { outcome: "finished" });
    const after = await json("GET", "/api/v1/settings");

    expect(after.body.savedLocale).toBe("id");
    expect(after.body.guide.outcome).toBe("finished");
    await json("POST", "/api/v1/settings", { locale: "en" });
  });

  it("is not wiped by saving a gateway key setting or by signing out of the gateway", async () => {
    await json("POST", "/api/v1/settings/guide", { outcome: "closed" });
    await json("POST", "/api/v1/settings", { editTurnCapUsd: 3 });
    expect((await guide()).outcome).toBe("closed");

    const signedOut = await json("POST", "/api/v1/settings/reset", { scope: "key" });
    expect(signedOut.status).toBe(200);
    // Forgetting the key is not a fresh install: the person has still seen the tour.
    expect((await guide()).outcome).toBe("closed");
  });
});

describe("the record is per person, never inherited", () => {
  const tenantId = "tenant-guide";
  const alice = { tenantId, workspaceId: "desk-1", userId: "alice" };
  const bob = { tenantId, workspaceId: "desk-1", userId: "bob" };

  it("gives one user's outcome to that user only", () => {
    expect(store.loadUserGuide(alice)).toBeNull();

    store.saveUserGuide(alice, "finished", 1_790_000_000_000);

    expect(store.loadUserGuide(alice)).toEqual({ outcome: "finished", at: 1_790_000_000_000 });
    expect(store.loadUserGuide(bob)).toBeNull();
  });

  it("keeps both people's records and their languages apart in the one sealed payload", () => {
    store.saveUserLocale(alice, "id");
    store.saveUserGuide(bob, "skipped", 5);
    store.saveUserGuide(alice, "closed", 6);
    store.resetSettingsCacheForTests();

    expect(store.loadUserGuide(alice)).toEqual({ outcome: "closed", at: 6 });
    expect(store.loadUserGuide(bob)).toEqual({ outcome: "skipped", at: 5 });
    expect(store.loadUserLocale(alice)).toBe("id");
  });

  it("refuses to record for a caller with no user id, and reads nothing for one", () => {
    expect(() => store.saveUserGuide({ tenantId, workspaceId: "desk-1", userId: "  " }, "closed")).toThrow(
      /signed-in user/,
    );
    expect(store.loadUserGuide({ tenantId, workspaceId: "desk-1", userId: "" })).toBeNull();
  });
});
