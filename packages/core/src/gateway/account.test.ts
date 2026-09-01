import { describe, expect, it } from "vitest";
import { GATEWAY_BASE_URL, QUOTA_PER_USD, formatUsd, gatewayOriginFromBaseUrl, quotaToUsd } from "../gateway";
import {
  asRunUsageRecord,
  estimateDeskByModel,
  estimateDeskUsd,
  estimateRunUsd,
  fetchThisKeyUsage,
  loadThisKeyState,
  parsePricingCatalog,
  parseTokenUsage,
  readLanguageModelUsage,
} from "./account";

const catalog = parsePricingCatalog({
  success: true,
  group_ratio: { Value: 0.5, Enterprise: 1 },
  data: [
    {
      model_name: "gpt-5.6-sol",
      quota_type: 0,
      model_ratio: 2,
      completion_ratio: 5,
      model_price: 0,
    },
    {
      model_name: "seedance-2.0-fast",
      quota_type: 0,
      model_ratio: 37.5,
      completion_ratio: 1,
      model_price: 0,
      billing_mode: "tiered_expr",
    },
    {
      model_name: "fixed-image",
      quota_type: 1,
      model_ratio: 0,
      completion_ratio: 1,
      model_price: 0.04,
    },
  ],
});

describe("gatewayOriginFromBaseUrl", () => {
  it("strips /v1 from the Toko Token default", () => {
    expect(gatewayOriginFromBaseUrl(GATEWAY_BASE_URL)).toBe("https://api.tokotokenai.com");
    expect(gatewayOriginFromBaseUrl("https://api.tokotokenai.com/v1/")).toBe("https://api.tokotokenai.com");
  });

  it("keeps a custom NewAPI host", () => {
    expect(gatewayOriginFromBaseUrl("https://gw.example.com/v1")).toBe("https://gw.example.com");
  });
});

describe("quotaToUsd / formatUsd", () => {
  it("uses 500000 quota per dollar", () => {
    expect(quotaToUsd(QUOTA_PER_USD)).toBe(1);
    expect(quotaToUsd(250_000)).toBe(0.5);
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("parseTokenUsage", () => {
  it("reads NewAPI token usage into USD and never keeps a key", () => {
    const parsed = parseTokenUsage({
      success: true,
      data: {
        name: "Default Token",
        total_granted: 1_000_000,
        total_used: 125_000,
        total_available: 875_000,
        unlimited_quota: false,
        expires_at: 0,
      },
    });
    expect(parsed).toEqual({
      name: "Default Token",
      usedUsd: 0.25,
      remainingUsd: 1.75,
      unlimited: false,
      expiresAt: 0,
    });
    expect(JSON.stringify(parsed)).not.toMatch(/sk-/);
  });

  it("treats unlimited tokens as no remaining cap", () => {
    const parsed = parseTokenUsage({
      data: { total_used: 0, total_available: 0, unlimited_quota: true, expires_at: 0 },
    });
    expect(parsed?.unlimited).toBe(true);
    expect(parsed?.remainingUsd).toBeNull();
  });
});

describe("estimateRunUsd", () => {
  it("prices ratio models from input and output tokens", () => {
    // (1000 + 200*5) * 2 / 500000 = 0.008
    const usd = estimateRunUsd(
      { model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200 },
      catalog,
    );
    expect(usd).toBeCloseTo(0.008, 6);
  });

  it("does not invent a number for tiered_expr video", () => {
    expect(
      estimateRunUsd({ model: "seedance-2.0-fast", inputTokens: 10, outputTokens: 10 }, catalog),
    ).toBeNull();
  });

  it("uses model_price for fixed per-call models", () => {
    expect(estimateRunUsd({ model: "fixed-image", inputTokens: 0, outputTokens: 0, unknown: false }, catalog)).toBe(
      0.04,
    );
  });
});

describe("estimateDeskUsd", () => {
  it("sums priced runs and counts unknown separately", () => {
    const desk = estimateDeskUsd(
      [
        { model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200 },
        { model: "seedance-2.0-fast", inputTokens: 1, outputTokens: 1 },
        { model: "missing-model", inputTokens: 10, outputTokens: 10 },
      ],
      catalog,
    );
    expect(desk.pricedCount).toBe(1);
    expect(desk.unknownCount).toBe(2);
    expect(desk.usd).toBeCloseTo(0.008, 6);
  });
});

describe("estimateDeskByModel", () => {
  it("sums USD and tokens per model and keeps unpriced models without inventing a number", () => {
    const rows = estimateDeskByModel(
      [
        { model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200 },
        { model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200 },
        { model: "fixed-image", inputTokens: 0, outputTokens: 0 },
        { model: "seedance-2.0-fast", inputTokens: 1, outputTokens: 1 },
      ],
      catalog,
    );
    expect(rows.map((row) => row.model)).toEqual(["fixed-image", "gpt-5.6-sol", "seedance-2.0-fast"]);
    expect(rows[0]).toMatchObject({ model: "fixed-image", usd: 0.04, runCount: 1, unknown: false });
    expect(rows[1].model).toBe("gpt-5.6-sol");
    expect(rows[1].runCount).toBe(2);
    expect(rows[1].inputTokens).toBe(2000);
    expect(rows[1].outputTokens).toBe(400);
    expect(rows[1].usd).toBeCloseTo(0.016, 6);
    expect(rows[1].unknown).toBe(false);
    expect(rows[2]).toMatchObject({
      model: "seedance-2.0-fast",
      usd: 0,
      runCount: 1,
      unknown: true,
    });
  });
});

describe("readLanguageModelUsage / asRunUsageRecord", () => {
  it("accepts AI SDK and OpenAI field names", () => {
    expect(readLanguageModelUsage({ promptTokens: 3, completionTokens: 7 })).toEqual({
      inputTokens: 3,
      outputTokens: 7,
    });
    expect(readLanguageModelUsage({ inputTokens: 1, outputTokens: 2 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
    });
    expect(asRunUsageRecord({ model: "gpt-5.6-sol", inputTokens: 3, outputTokens: 0 })).toEqual({
      model: "gpt-5.6-sol",
      inputTokens: 3,
      outputTokens: 0,
    });
    expect(asRunUsageRecord({ model: "x", inputTokens: 0, outputTokens: 0 })).toBeNull();
  });
});

describe("fetchThisKeyUsage", () => {
  it("calls /api/usage/token with the Bearer key and returns USD only", async () => {
    const calls: string[] = [];
    const usage = await fetchThisKeyUsage({
      apiKey: "sk-test-key-value-long",
      fetch: async (url, init) => {
        calls.push(String(url));
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-key-value-long");
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              object: "token_usage",
              name: "Default Token",
              total_granted: 500_000,
              total_used: 100_000,
              total_available: 400_000,
              unlimited_quota: false,
              expires_at: 0,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    expect(calls[0]).toBe("https://api.tokotokenai.com/api/usage/token");
    expect(usage.usedUsd).toBeCloseTo(0.2);
    expect(usage.remainingUsd).toBeCloseTo(0.8);
    expect(JSON.stringify(usage)).not.toContain("sk-test");
  });

  it("falls back to dashboard billing when usage/token is 404", async () => {
    const usage = await fetchThisKeyUsage({
      apiKey: "sk-test-key-value-long",
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/api/usage/token")) {
          return new Response(JSON.stringify({ success: false }), { status: 404 });
        }
        if (target.endsWith("/v1/dashboard/billing/subscription")) {
          return new Response(JSON.stringify({ hard_limit_usd: 10 }), { status: 200 });
        }
        return new Response(JSON.stringify({ total_usage: 2.5 }), { status: 200 });
      },
    });
    expect(usage.usedUsd).toBe(2.5);
    expect(usage.remainingUsd).toBe(7.5);
  });
});

describe("loadThisKeyState", () => {
  it("is needs_key without a secret", async () => {
    expect(await loadThisKeyState({})).toEqual({ status: "needs_key" });
  });
});
