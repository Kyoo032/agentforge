import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "./router";
import { resetBackendHealthForTests } from "./knowledge/registry";

let settingsDir: string;
const previous: Record<string, string | undefined> = {};
const ENV_KEYS = ["AGENTFORGE_SETTINGS_PATH", "AGENTFORGE_RUNTIME"] as const;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
  }
  settingsDir = mkdtempSync(join(tmpdir(), "af-backend-routes-"));
  process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  process.env.AGENTFORGE_RUNTIME = "stub";
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
  it("reports builtin on GET /api/v1/knowledge", async () => {
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
        available: true,
        reason: null,
        outbox: 0,
      },
    });
  }, 30_000);

  it("rejects WeKnora as not part of the product", async () => {
    const result = await call("PUT", "/api/v1/knowledge/backend", { id: "weknora" });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "invalid_request" } });
  }, 30_000);

  it("selects builtin", async () => {
    const result = await call("PUT", "/api/v1/knowledge/backend", { id: "builtin" });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: "builtin",
      selected: "builtin",
      available: true,
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
});
