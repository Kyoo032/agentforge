import { describe, expect, it } from "vitest";
import { GATEWAY_BASE_URL, QUOTA_PER_USD, formatUsd, gatewayOriginFromBaseUrl, quotaToUsd } from "../gateway";
import {
  asRunUsageRecord,
  buildUsageBuckets,
  estimateDeskByModel,
  estimateDeskUsd,
  estimateRunUsd,
  fetchThisKeyUsage,
  listUsageBucketFrames,
  loadThisKeyState,
  parsePricingCatalog,
  parseTokenUsage,
  parseUsageRange,
  readLanguageModelUsage,
  summarizeUsageDesk,
  USAGE_TOKEN_PATH,
  usageBucketKey,
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
    const usd = estimateRunUsd({ model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200 }, catalog);
    expect(usd).toBeCloseTo(0.008, 6);
  });

  it("does not invent a number for tiered_expr video", () => {
    expect(estimateRunUsd({ model: "seedance-2.0-fast", inputTokens: 10, outputTokens: 10 }, catalog)).toBeNull();
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
    expect(calls[0]).toBe("https://api.tokotokenai.com/api/usage/token/");
    expect(usage.usedUsd).toBeCloseTo(0.2);
    expect(usage.remainingUsd).toBeCloseTo(0.8);
    expect(JSON.stringify(usage)).not.toContain("sk-test");
  });

  it("asks for the trailing-slash usage path so the gateway never redirects", async () => {
    const calls: string[] = [];
    await fetchThisKeyUsage({
      baseURL: GATEWAY_BASE_URL,
      apiKey: "sk-test-key-value-long",
      fetch: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ data: { total_used: 0, total_available: 0 } }), { status: 200 });
      },
    });
    expect(calls).toEqual([`${gatewayOriginFromBaseUrl(GATEWAY_BASE_URL)}${USAGE_TOKEN_PATH}`]);
    expect(USAGE_TOKEN_PATH).toBe("/api/usage/token/");
  });

  it("falls back to dashboard billing when usage/token is 404", async () => {
    const usage = await fetchThisKeyUsage({
      apiKey: "sk-test-key-value-long",
      fetch: async (url) => {
        const target = String(url);
        if (target.endsWith("/api/usage/token/")) {
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

describe("usage bucketing", () => {
  // Thursday 2026-09-03 local — ISO week 36.
  const now = new Date(2026, 8, 3, 15, 30, 0);

  it("parseUsageRange defaults invalid or missing to day", () => {
    expect(parseUsageRange(undefined)).toBe("day");
    expect(parseUsageRange("")).toBe("day");
    expect(parseUsageRange("year")).toBe("day");
    expect(parseUsageRange("week")).toBe("week");
    expect(parseUsageRange("month")).toBe("month");
  });

  it("maps a run on day 0 into the matching day/week/month keys", () => {
    expect(usageBucketKey(now, "day")).toBe("2026-09-03");
    expect(usageBucketKey(now, "week")).toBe("2026-W36");
    expect(usageBucketKey(now, "month")).toBe("2026-09");
  });

  it("lists empty day frames oldest → newest including today", () => {
    const frames = listUsageBucketFrames("day", now);
    expect(frames).toHaveLength(14);
    expect(frames[0]?.key).toBe("2026-08-21");
    expect(frames.at(-1)?.key).toBe("2026-09-03");
    expect(listUsageBucketFrames("week", now)).toHaveLength(8);
    expect(listUsageBucketFrames("month", now)).toHaveLength(6);
    expect(listUsageBucketFrames("month", now).at(-1)?.key).toBe("2026-09");
  });

  it("keeps empty day buckets and prices the day-0 run", () => {
    const buckets = buildUsageBuckets(
      [{ model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200, startedAt: now }],
      "day",
      catalog,
      now,
    );
    expect(buckets).toHaveLength(14);
    expect(buckets.filter((bucket) => bucket.usd === 0 && bucket.models.length === 0)).toHaveLength(13);
    const today = buckets.at(-1);
    expect(today?.key).toBe("2026-09-03");
    expect(today?.usd).toBeCloseTo(0.008, 6);
    expect(today?.models).toHaveLength(1);
    expect(today?.models[0]).toMatchObject({
      model: "gpt-5.6-sol",
      runCount: 1,
      inputTokens: 1000,
      outputTokens: 200,
    });
    expect(today?.models[0]?.usd).toBeCloseTo(0.008, 6);
  });

  it("lands the same run in week and month buckets with empty siblings", () => {
    const run = { model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200, startedAt: now };
    const weeks = buildUsageBuckets([run], "week", catalog, now);
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)?.key).toBe("2026-W36");
    expect(weeks.at(-1)?.usd).toBeCloseTo(0.008, 6);
    expect(weeks.slice(0, -1).every((bucket) => bucket.usd === 0)).toBe(true);

    const months = buildUsageBuckets([run], "month", catalog, now);
    expect(months).toHaveLength(6);
    expect(months.map((bucket) => bucket.key)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(months.at(-1)?.usd).toBeCloseTo(0.008, 6);
  });

  it("summarizes desk byModel usd desc then model name", () => {
    const desk = summarizeUsageDesk(
      [
        { model: "gpt-5.6-sol", inputTokens: 1000, outputTokens: 200, startedAt: now },
        { model: "fixed-image", inputTokens: 0, outputTokens: 0, startedAt: now },
        { model: "aaa-unknown", inputTokens: 1, outputTokens: 1, startedAt: now },
      ],
      catalog,
    );
    expect(desk.modelCount).toBe(3);
    expect(desk.byModel.map((row) => row.model)).toEqual(["fixed-image", "gpt-5.6-sol", "aaa-unknown"]);
    expect(desk.pricedCount).toBe(2);
    expect(desk.unknownCount).toBe(1);
  });
});

describe("gateway account requests", () => {
  it("returns parsed usage from a 200 without any redirect", async () => {
    const calls: string[] = [];
    const usage = await fetchThisKeyUsage({
      baseURL: GATEWAY_BASE_URL,
      apiKey: "sk-not-a-real-key",
      fetch: async (url) => {
        calls.push(String(url));
        return new Response(
          JSON.stringify({ data: { total_granted: 500_000, total_used: 100_000, total_available: 400_000 } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    expect(calls).toHaveLength(1);
    expect(usage.usedUsd).toBeCloseTo(0.2);
    expect(usage.remainingUsd).toBeCloseTo(0.8);
  });

  it("follows a same-origin 301 once and reads usage from the target", async () => {
    const origin = gatewayOriginFromBaseUrl(GATEWAY_BASE_URL);
    const calls: string[] = [];
    const usage = await fetchThisKeyUsage({
      baseURL: GATEWAY_BASE_URL,
      apiKey: "sk-not-a-real-key",
      fetch: async (url, init) => {
        const target = String(url);
        calls.push(target);
        expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
          "Bearer sk-not-a-real-key",
        );
        if (calls.length === 1) {
          return new Response(null, { status: 301, headers: { location: "/api/usage/token/v2" } });
        }
        return new Response(JSON.stringify({ data: { total_granted: 200_000, total_used: 200_000 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    expect(calls).toEqual([`${origin}${USAGE_TOKEN_PATH}`, `${origin}/api/usage/token/v2`]);
    expect(usage.usedUsd).toBeCloseTo(0.4);
  });

  it("refuses a second same-origin hop", async () => {
    const calls: string[] = [];
    await expect(
      fetchThisKeyUsage({
        baseURL: GATEWAY_BASE_URL,
        apiKey: "sk-not-a-real-key",
        fetch: async (url) => {
          calls.push(String(url));
          return new Response(null, { status: 308, headers: { location: `/hop/${calls.length}` } });
        },
      }),
    ).rejects.toThrow(/redirected \(308\)/);
    expect(calls).toHaveLength(2);
  });

  it("does not follow a redirect while carrying the gateway key", async () => {
    const calls: string[] = [];
    await expect(
      fetchThisKeyUsage({
        baseURL: GATEWAY_BASE_URL,
        apiKey: "sk-not-a-real-key",
        fetch: async (input, init) => {
          calls.push(String(input));
          expect((init as RequestInit).redirect).toBe("manual");
          return new Response(null, { status: 302, headers: { location: "https://evil.example/usage" } });
        },
      }),
    ).rejects.toThrow(/redirected \(302\)/);
    expect(calls).toHaveLength(1);
  });

  it("does not put the key in the redirect error", async () => {
    try {
      await fetchThisKeyUsage({
        baseURL: GATEWAY_BASE_URL,
        apiKey: "sk-not-a-real-key",
        fetch: async () => new Response(null, { status: 307, headers: { location: "https://evil.example" } }),
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("sk-not-a-real-key");
      expect(String((error as Error).message)).not.toContain("evil.example");
    }
  });
});
