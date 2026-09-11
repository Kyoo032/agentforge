import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "./router";
import { resetBackendHealthForTests } from "./knowledge/registry";

/**
 * The additive contract the Knowledge page reads: `GET /api/v1/knowledge` gains a `backend` object,
 * `PUT /api/v1/knowledge/backend` changes it, and `POST /api/v1/knowledge/backend/reindex` starts a
 * backfill. Nothing that existed before changes shape, which is what lets the web side ship
 * independently.
 */

let settingsDir: string;
const previous: Record<string, string | undefined> = {};
const ENV_KEYS = ["AGENTFORGE_SETTINGS_PATH", "AGENTFORGE_RUNTIME", "AGENTFORGE_WEKNORA_PATH"] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
  }
  settingsDir = mkdtempSync(join(tmpdir(), "af-backend-routes-"));
  process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  process.env.AGENTFORGE_RUNTIME = "stub";
  // No sidecar staged: the default state on every machine that has not run the staging script.
  delete process.env.AGENTFORGE_WEKNORA_PATH;
  resetBackendHealthForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetBackendHealthForTests();
  rmSync(settingsDir, { recursive: true, force: true });
});

function call(method: string, path: string, body?: unknown) {
  return dispatch({ method, path, query: {}, params: {}, headers: {}, body });
}

describe("knowledge backend routes", () => {
  it("reports the backend on GET /api/v1/knowledge", async () => {
    const result = await call("GET", "/api/v1/knowledge");
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      backend: {
        id: "builtin",
        selected: "builtin",
        // `available` is about the machine, not the selection: it is what the Knowledge page's card
        // reads to decide whether to offer the switch at all. No binary staged here, so no switch.
        available: false,
        reason: "not_staged",
        outbox: expect.any(Number),
      },
    });
    // Health is only probed for a selected sidecar, so builtin reports null rather than a guess.
    expect((result.body as { backend: { health: unknown } }).backend.health).toBeNull();
  }, 30_000);

  it("refuses to select WeKnora when the sidecar is not installed", async () => {
    const result = await call("PUT", "/api/v1/knowledge/backend", { id: "weknora" });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: { code: "backend_unavailable" } });

    // And the setting is unchanged, so the desk is not left pointing at nothing.
    const after = await call("GET", "/api/v1/knowledge");
    if (after.type === "json") {
      expect(after.body).toMatchObject({ backend: { selected: "builtin", id: "builtin" } });
    }
  }, 30_000);

  it("selects the builtin backend and answers with the same backend object", async () => {
    const result = await call("PUT", "/api/v1/knowledge/backend", { id: "builtin" });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: "builtin",
      selected: "builtin",
      available: false,
      reason: "not_staged",
      health: null,
      outbox: expect.any(Number),
    });
  }, 30_000);

  it("rejects an unknown backend id with a 400", async () => {
    const result = await call("PUT", "/api/v1/knowledge/backend", { id: "elasticsearch" });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: "invalid_request" } });
    }
  }, 30_000);

  it("queues nothing for a desk that has not selected WeKnora", async () => {
    const result = await call("POST", "/api/v1/knowledge/backend/reindex");
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(202);
    // Nothing to push into a backend this desk does not use — and nothing spawned to find out.
    expect(result.body).toEqual({ queued: 0 });
  }, 30_000);
});
