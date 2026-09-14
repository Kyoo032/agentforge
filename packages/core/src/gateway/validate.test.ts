import { describe, expect, it } from "vitest";
import { PINNED_GATEWAY_BASE_URL } from "./pinned";
import { validateGatewayKey } from "./validate";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("validateGatewayKey", () => {
  it("calls the pinned /models with a Bearer header and reports ok", async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const result = await validateGatewayKey({
      apiKey: "sk-live-key",
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        seen.url = String(url);
        seen.headers = init?.headers as Record<string, string>;
        return jsonResponse({ data: [{ id: "gpt-5" }, { id: "gemini-3" }] });
      }) as unknown as typeof fetch,
    });
    expect(seen.url).toBe(`${PINNED_GATEWAY_BASE_URL}/models`);
    expect(seen.headers?.Authorization).toBe("Bearer sk-live-key");
    expect(result).toEqual({ status: "ok", modelCount: 2 });
  });

  it("treats 401 and 403 as an invalid key", async () => {
    for (const httpStatus of [401, 403]) {
      const result = await validateGatewayKey({
        apiKey: "sk-bad",
        fetch: (async () => jsonResponse({ error: "no" }, httpStatus)) as unknown as typeof fetch,
      });
      expect(result).toEqual({ status: "invalid_key", httpStatus });
    }
  });

  it("reports unreachable for a network failure", async () => {
    const result = await validateGatewayKey({
      apiKey: "sk-live",
      fetch: (async () => {
        const error = new TypeError("fetch failed");
        (error as { cause?: { code: string } }).cause = { code: "ECONNREFUSED" };
        throw error;
      }) as unknown as typeof fetch,
    });
    expect(result.status).toBe("unreachable");
  });

  it("reports unreachable when the probe times out", async () => {
    const result = await validateGatewayKey({
      apiKey: "sk-live",
      fetch: (async () => {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }) as unknown as typeof fetch,
    });
    expect(result.status).toBe("unreachable");
  });

  it("reports error for any other non-ok status", async () => {
    const result = await validateGatewayKey({
      apiKey: "sk-live",
      fetch: (async () => jsonResponse({ error: "boom" }, 503)) as unknown as typeof fetch,
    });
    expect(result).toMatchObject({ status: "error", httpStatus: 503 });
  });

  it("refuses an empty key without calling the gateway", async () => {
    let called = false;
    const result = await validateGatewayKey({
      apiKey: "   ",
      fetch: (async () => {
        called = true;
        return jsonResponse({});
      }) as unknown as typeof fetch,
    });
    expect(called).toBe(false);
    expect(result.status).toBe("invalid_key");
  });

  it("never echoes the key back in a message", async () => {
    const apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz012345";
    const result = await validateGatewayKey({
      apiKey,
      fetch: (async () => {
        throw new Error(`connect failed for ${apiKey}`);
      }) as unknown as typeof fetch,
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });
});
