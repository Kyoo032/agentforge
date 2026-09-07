import { describe, expect, it } from "vitest";
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
        productName: "Agentforge",
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
