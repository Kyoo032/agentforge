import { describe, expect, it, vi } from "vitest";
import { dispatch } from "./router";

describe("host router", () => {
  it("answers GET /api/v1/ping without a database", async () => {
    const result = await dispatch({
      method: "GET",
      path: "/api/v1/ping",
      query: {},
      params: {},
      headers: {},
    });
    expect(result).toEqual({
      type: "json",
      status: 200,
      body: {
        ok: true,
        transport: "host",
        productName: "DPSBuddy",
        gatewayName: "Toko Token",
        gatewayBaseUrl: "https://api.tokotokenai.com/v1",
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
        const result = await dispatch({ method: "POST", path, query: {}, params: {}, headers: {}, body: { brief: {} } });
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
