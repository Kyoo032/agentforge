import { describe, expect, it } from "vitest";
import type { PricingCatalog } from "@agentforge/core";
import { loadPriceLookup, priceLabelFor } from "./pricing";

const catalog: PricingCatalog = {
  groupRatio: { default: 1 },
  models: [
    { modelName: "per-token", quotaType: 0, modelRatio: 1, completionRatio: 4, modelPrice: 0 },
    { modelName: "Cheap-Model", quotaType: 0, modelRatio: 0.05, completionRatio: 5, modelPrice: 0 },
    { modelName: "per-call", quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0.05 },
    { modelName: "tiered", quotaType: 0, modelRatio: 0, completionRatio: 0, modelPrice: 0, billingMode: "tiered_expr" },
    { modelName: "free-ish", quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0 },
  ],
};

describe("priceLabelFor", () => {
  it("prices a per-token model in dollars per million input and output tokens, the way the app estimates a run", () => {
    // One million input tokens at model ratio 1 is 1 000 000 quota; 500 000 quota is a dollar.
    expect(priceLabelFor(catalog, "per-token")).toBe("$2.00 in / $8.00 out per 1M");
  });

  it("keeps enough digits for a cheap model", () => {
    expect(priceLabelFor(catalog, "cheap-model")).toBe("$0.1000 in / $0.5000 out per 1M");
  });

  it("matches the id without regard to case, as the app's own lookup does", () => {
    expect(priceLabelFor(catalog, "CHEAP-MODEL")).toBe(priceLabelFor(catalog, "cheap-model"));
  });

  it("prices a per-call model per call", () => {
    expect(priceLabelFor(catalog, "per-call")).toBe("$0.0500 per call");
  });

  it("does not invent a number for tiered or unpriced billing", () => {
    expect(priceLabelFor(catalog, "tiered")).toBe("no flat price (tiered or unpriced billing)");
    expect(priceLabelFor(catalog, "free-ish")).toBe("no flat price (tiered or unpriced billing)");
  });

  it("says a model is missing from the price list rather than guessing", () => {
    expect(priceLabelFor(catalog, "nobody-knows")).toBeUndefined();
  });
});

describe("loadPriceLookup", () => {
  const body = {
    data: [{ model_name: "per-token", quota_type: 0, model_ratio: 1, completion_ratio: 4, model_price: 0 }],
    group_ratio: { default: 1 },
  };

  it("reads the gateway's public price list with the fetch it is given, and returns a lookup", async () => {
    const seen: string[] = [];
    const fake = (async (url: unknown) => {
      seen.push(String(url));
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await loadPriceLookup({ baseUrl: "https://gateway.example.test/v1", fetch: fake });
    expect(seen).toEqual(["https://gateway.example.test/api/pricing"]);
    expect(result.note).toMatch(/public price list/);
    expect(result.priceOf?.("per-token")).toBe("$2.00 in / $8.00 out per 1M");
    expect(result.priceOf?.("unlisted")).toBe("not in the price list");
  });

  it("sends no credential: the price list is public", async () => {
    let headers: RequestInit["headers"] | undefined;
    const fake = (async (_url: unknown, init?: RequestInit) => {
      headers = init?.headers;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await loadPriceLookup({ baseUrl: "https://gateway.example.test/v1", fetch: fake });
    expect(JSON.stringify(headers ?? {})).not.toMatch(/authorization|bearer|api-key/i);
  });

  it("degrades to no prices, with the reason, when the list cannot be read", async () => {
    const fake = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    const result = await loadPriceLookup({ baseUrl: "https://gateway.example.test/v1", fetch: fake });
    expect(result.priceOf).toBeUndefined();
    expect(result.note).toMatch(/price list unavailable/i);
    const thrown = await loadPriceLookup({
      baseUrl: "https://gateway.example.test/v1",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    expect(thrown.priceOf).toBeUndefined();
    expect(thrown.note).toMatch(/fetch failed/);
  });
});
