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
      body: { ok: true, transport: "host" },
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
