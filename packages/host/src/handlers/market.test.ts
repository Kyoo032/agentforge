import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_NOW, packet } from "../market/__fixtures__/watch";
import { buildMarketBriefing } from "../market-briefing-build";
import type { HostRequest } from "../types";
import { handlePostMarket, handlePostMarketDocx, handlePostMarketRegen } from "./market";

function request(path: string, body: unknown): HostRequest {
  return { method: "POST", path, query: {}, params: {}, headers: {}, body };
}

const { briefing } = buildMarketBriefing(
  { title: "MU and BBCA pre-market", sections: [{ heading: "TL;DR", body: "MU at 1000.26; sentiment bullish." }] },
  packet(),
  { language: "en", generatedAt: FIXTURE_NOW.toISOString() },
);

describe("handlePostMarketDocx", () => {
  it("renders a guarded briefing as a DOCX, from { briefing } or the bare briefing", async () => {
    for (const body of [{ briefing }, briefing]) {
      const result = await handlePostMarketDocx(request("/api/v1/market/docx", body));
      expect(result.type).toBe("bytes");
      if (result.type !== "bytes") {
        return;
      }
      expect(result.status).toBe(200);
      expect(result.filename).toBe("MU-and-BBCA-pre-market.docx");
      expect(result.contentType).toContain("wordprocessingml");
      expect(result.bytes[0]).toBe(0x50);
    }
  });

  it("rejects a malformed briefing with 400", async () => {
    const result = await handlePostMarketDocx(request("/api/v1/market/docx", { briefing: { nope: true } }));
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "invalid_request" } });
  });

  it("refuses to render a briefing that carries directive language with 502 advice_leak", async () => {
    const leaked = { ...briefing, sections: [{ heading: "TL;DR", body: "MU 1000.26, beli sekarang." }] };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await handlePostMarketDocx(request("/api/v1/market/docx", { briefing: leaked }));
      expect(result.type).toBe("json");
      if (result.type !== "json") {
        return;
      }
      expect(result.status).toBe(502);
      expect(result.body).toMatchObject({ error: { code: "advice_leak" } });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("sections[0].body"));
    } finally {
      error.mockRestore();
    }
  });
});

describe("handlePostMarket / handlePostMarketRegen on the stub runtime", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTFORGE_RUNTIME", "stub");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 503 runtime_stub without a gateway key", async () => {
    const generate = await handlePostMarket(request("/api/v1/market", { prompt: "x", tickers: ["MU"] }));
    expect(generate.type).toBe("json");
    if (generate.type === "json") {
      expect(generate.status).toBe(503);
      expect(generate.body).toMatchObject({ error: { code: "runtime_stub" } });
    }
    const regen = await handlePostMarketRegen(request("/api/v1/market/regenerate", { briefing, section: 0 }));
    expect(regen.type).toBe("json");
    if (regen.type === "json") {
      expect(regen.status).toBe(503);
      expect(regen.body).toMatchObject({ error: { code: "runtime_stub" } });
    }
  });
});
