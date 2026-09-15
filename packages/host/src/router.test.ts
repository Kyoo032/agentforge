import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HostRequest, HostResult } from "./types";

// Isolation: several routes resolve a tenant, which opens the kernel SQLite and records the desk in
// `workspace-id.txt`. Point the data dir at a temp folder BEFORE the router is imported so none of
// that lands in the repo's own data/ directory.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-router-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_SECRETS_KEY = "e".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

let dispatch: (request: HostRequest) => Promise<HostResult>;

describe("host router", () => {
  beforeAll(async () => {
    ({ dispatch } = await import("./router"));
  }, 60_000);

  afterAll(async () => {
    // The kernel SQLite lives in dataDir; close it so Windows releases the file before cleanup.
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  it("answers GET /api/v1/ping without a database", async () => {
    const result = await dispatch({
      method: "GET",
      path: "/api/v1/ping",
      query: {},
      params: {},
      headers: {},
    });
    expect(result).toMatchObject({
      type: "json",
      status: 200,
      body: {
        ok: true,
        transport: "host",
        productName: "DPSBuddy",
        gatewayName: "Toko Token",
        gatewayBaseUrl: "https://api.tokotokenai.com/v1",
        locale: expect.stringMatching(/^(en|id)$/),
        savedLocale: expect.stringMatching(/^(en|id)$/),
      },
    });
  });

  it("answers GET /api/v1/edit/doctor without a gateway key", async () => {
    const result = await dispatch({
      method: "GET",
      path: "/api/v1/edit/doctor",
      query: {},
      params: {},
      headers: {},
    });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ffmpeg: expect.objectContaining({ found: expect.any(Boolean) }),
      asr: expect.objectContaining({ available: expect.any(Boolean) }),
      fonts: [],
    });
  });

  it("routes the Market job: 503 runtime_stub without a gateway key, 400 for a malformed brief", async () => {
    vi.stubEnv("AGENTFORGE_RUNTIME", "stub");
    try {
      const generate = await dispatch({
        method: "POST",
        path: "/api/v1/market",
        query: {},
        params: {},
        headers: {},
        body: { prompt: "Pre-market briefing", tickers: ["BBCA"] },
      });
      expect(generate.type).toBe("json");
      if (generate.type === "json") {
        expect(generate.status).toBe(503);
        expect(generate.body).toMatchObject({ error: { code: "runtime_stub" } });
      }
      // The same route answers 400 for a body the schema rejects, key or no key.
      const malformed = await dispatch({
        method: "POST",
        path: "/api/v1/market",
        query: {},
        params: {},
        headers: {},
        body: { ticker: "BBCA" },
      });
      expect(malformed.type).toBe("json");
      if (malformed.type === "json") {
        expect(malformed.status).toBe(400);
        expect(malformed.body).toMatchObject({ error: { code: "invalid_request" } });
      }
      // The keyless watch board is routed and validates its own body.
      const board = await dispatch({
        method: "POST",
        path: "/api/v1/market/board",
        query: {},
        params: {},
        headers: {},
        body: { tickers: [] },
      });
      expect(board.type).toBe("json");
      if (board.type === "json") {
        expect(board.status).toBe(400);
        expect(board.body).toMatchObject({ error: { code: "invalid_request" } });
      }
      for (const path of ["/api/v1/market/regenerate", "/api/v1/market/docx"]) {
        const result = await dispatch({
          method: "POST",
          path,
          query: {},
          params: {},
          headers: {},
          body: { brief: {} },
        });
        expect(result.type).toBe("json");
        if (result.type === "json") {
          expect(result.status).toBe(400);
          expect(result.body).toMatchObject({ error: { code: "invalid_request" } });
        }
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("routes the knowledge graph and self-check, and reports both on GET /api/v1/knowledge", async () => {
    vi.stubEnv("AGENTFORGE_RUNTIME", "stub");
    try {
      const graph = await dispatch({
        method: "GET",
        path: "/api/v1/knowledge/graph",
        query: { limit: "200" },
        params: {},
        headers: {},
      });
      expect(graph.type).toBe("json");
      if (graph.type === "json") {
        expect(graph.status).toBe(200);
        expect(graph.body).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array) });
      }

      const verify = await dispatch({
        method: "POST",
        path: "/api/v1/knowledge/verify",
        query: {},
        params: {},
        headers: {},
        body: {},
      });
      expect(verify.type).toBe("json");
      if (verify.type === "json") {
        expect(verify.status).toBe(200);
        expect(verify.body).toMatchObject({
          ok: expect.any(Boolean),
          at: expect.any(Number),
          detail: expect.any(String),
        });
      }

      const knowledge = await dispatch({
        method: "GET",
        path: "/api/v1/knowledge",
        query: {},
        params: {},
        headers: {},
      });
      expect(knowledge.type).toBe("json");
      if (knowledge.type === "json") {
        expect(knowledge.status).toBe(200);
        expect(knowledge.body).toMatchObject({
          retrievals: expect.any(Number),
          graph: { nodes: expect.any(Number), edges: expect.any(Number) },
          verified: { ok: expect.any(Boolean), at: expect.any(Number), detail: expect.any(String) },
        });
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns not_found JSON for unknown routes", async () => {
    const result = await dispatch({
      method: "GET",
      path: "/api/v1/does-not-exist",
      query: {},
      params: {},
      headers: {},
    });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: "not_found" } });
  });
});
