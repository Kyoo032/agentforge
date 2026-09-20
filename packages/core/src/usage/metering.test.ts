import { describe, expect, it } from "vitest";
import { explainRunUsd, type PricingCatalog } from "../gateway/account";
import {
  USAGE_MODES,
  USAGE_UNITS,
  UNPRICED_REASONS,
  isUnpricedReason,
  isUsageMode,
  isUsageUnit,
  microsToUsd,
  usdToMicros,
  usageModeFromRunPrefix,
} from "./metering";

describe("usdToMicros", () => {
  it("stores USD as integer millionths", () => {
    expect(usdToMicros(1)).toBe(1_000_000);
    expect(usdToMicros(0.04)).toBe(40_000);
    expect(usdToMicros(0)).toBe(0);
  });

  it("rounds to a whole micro rather than carrying a float into the ledger", () => {
    // 0.1 + 0.2 is the classic way to bill someone the wrong number; the ledger is integers only.
    expect(usdToMicros(0.1 + 0.2)).toBe(300_000);
    expect(Number.isInteger(usdToMicros(1 / 3) as number)).toBe(true);
  });

  it("refuses a number it must not invent, rather than coercing it to zero", () => {
    // `null` is "nobody could price this", which the caller turns into an unpriced row. A silent
    // 0 would be indistinguishable from a free call.
    expect(usdToMicros(null)).toBeNull();
    expect(usdToMicros(undefined)).toBeNull();
    expect(usdToMicros(Number.NaN)).toBeNull();
    expect(usdToMicros(Number.POSITIVE_INFINITY)).toBeNull();
    expect(usdToMicros(-1)).toBeNull();
  });

  it("round-trips through microsToUsd", () => {
    expect(microsToUsd(usdToMicros(0.04))).toBeCloseTo(0.04, 10);
    expect(microsToUsd(null)).toBe(0);
    expect(microsToUsd(Number.NaN)).toBe(0);
  });
});

describe("the ledger vocabulary", () => {
  it("guards every value it declares and nothing else", () => {
    for (const mode of USAGE_MODES) {
      expect(isUsageMode(mode)).toBe(true);
    }
    for (const unit of USAGE_UNITS) {
      expect(isUsageUnit(unit)).toBe(true);
    }
    for (const reason of UNPRICED_REASONS) {
      expect(isUnpricedReason(reason)).toBe(true);
    }
    expect(isUsageMode("telepathy")).toBe(false);
    expect(isUsageUnit("furlongs")).toBe(false);
    expect(isUnpricedReason("because")).toBe(false);
    expect(isUsageMode(undefined)).toBe(false);
  });

  it("meters the four units the modes actually consume", () => {
    expect([...USAGE_UNITS]).toEqual(["tokens", "images", "seconds", "jobs"]);
  });
});

describe("usageModeFromRunPrefix", () => {
  it("maps each job runPrefix in the repo to its own mode", () => {
    expect(usageModeFromRunPrefix("document")).toBe("documents");
    expect(usageModeFromRunPrefix("document-section")).toBe("documents");
    expect(usageModeFromRunPrefix("presentation-slide")).toBe("presentations");
    expect(usageModeFromRunPrefix("research")).toBe("research");
    expect(usageModeFromRunPrefix("finance-ratios-buckets")).toBe("finance");
    expect(usageModeFromRunPrefix("market-team")).toBe("market");
    expect(usageModeFromRunPrefix("knowledge-verifier")).toBe("knowledge");
    expect(usageModeFromRunPrefix("legal")).toBe("legal");
    expect(usageModeFromRunPrefix("data")).toBe("data");
    expect(usageModeFromRunPrefix("edit")).toBe("edit");
    expect(usageModeFromRunPrefix("music")).toBe("music");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(usageModeFromRunPrefix("  Document-Section ")).toBe("documents");
  });

  it("falls back to `other` rather than dropping a call it cannot classify", () => {
    // An unclassified call still leaves a row; it just lands under `other` until someone names it.
    expect(usageModeFromRunPrefix("enhance")).toBe("other");
    expect(usageModeFromRunPrefix("")).toBe("other");
    expect(usageModeFromRunPrefix(undefined as unknown as string)).toBe("other");
  });
});

describe("explainRunUsd", () => {
  const catalog: PricingCatalog = {
    models: [
      { modelName: "gpt-5.6-sol", quotaType: 0, modelRatio: 1, completionRatio: 3, modelPrice: 0 },
      { modelName: "flat", quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0.02 },
      {
        modelName: "tiered",
        quotaType: 0,
        modelRatio: 1,
        completionRatio: 1,
        modelPrice: 0,
        billingMode: "tiered_expr",
      },
    ],
    groupRatio: {},
  };

  it("names why a run could not be priced, instead of only saying it could not", () => {
    expect(explainRunUsd({ model: "gpt-5.6-sol", inputTokens: 0, outputTokens: 0, unknown: true }, catalog)).toEqual({
      usd: null,
      reason: "usage_unknown",
    });
    expect(explainRunUsd({ model: "not-here", inputTokens: 10, outputTokens: 1 }, catalog)).toEqual({
      usd: null,
      reason: "model_not_in_catalog",
    });
    expect(explainRunUsd({ model: "tiered", inputTokens: 10, outputTokens: 1 }, catalog)).toEqual({
      usd: null,
      reason: "tiered_billing",
    });
  });

  it("prices a flat per-call model and a per-token model", () => {
    expect(explainRunUsd({ model: "flat", inputTokens: 1, outputTokens: 1 }, catalog)).toEqual({ usd: 0.02 });
    const perToken = explainRunUsd({ model: "gpt-5.6-sol", inputTokens: 100, outputTokens: 40 }, catalog);
    expect(perToken.usd).toBeGreaterThan(0);
  });
});
