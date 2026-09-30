import {
  DEFAULT_GROUP_RATIO,
  explainRunUsd,
  fetchPricingCatalog,
  isUnpricedBilling,
  type PricingCatalog,
} from "@agentforge/core";

/** A dollar amount with enough digits to tell a cheap model from a free one. */
function usd(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toFixed(4);
}

function findModel(catalog: PricingCatalog, id: string) {
  const needle = id.trim().toLowerCase();
  return catalog.models.find((model) => model.modelName.toLowerCase() === needle);
}

/**
 * What the gateway charges for `id`, read from its public price list by the same estimator the app's
 * usage panel and run cost use (`explainRunUsd`): a million input tokens and a million output tokens, or
 * one call. `undefined` when the list does not carry the model. Prices are at the app's default group
 * ratio (1); a key that sits in a cheaper group pays less.
 */
export function priceLabelFor(catalog: PricingCatalog, id: string): string | undefined {
  const model = findModel(catalog, id);
  if (!model) {
    return undefined;
  }
  if (isUnpricedBilling(model)) {
    return "no flat price (tiered or unpriced billing)";
  }
  if (model.quotaType === 1) {
    return `$${usd(model.modelPrice * DEFAULT_GROUP_RATIO)} per call`;
  }
  const input = explainRunUsd({ model: model.modelName, inputTokens: 1_000_000, outputTokens: 0 }, catalog);
  const output = explainRunUsd({ model: model.modelName, inputTokens: 0, outputTokens: 1_000_000 }, catalog);
  if (input.usd === null || output.usd === null) {
    return "no flat price (tiered or unpriced billing)";
  }
  return `$${usd(input.usd)} in / $${usd(output.usd)} out per 1M`;
}

export type PriceLookup = {
  priceOf: ((id: string) => string) | undefined;
  /** Where the prices came from, or why there are none: printed in the report. */
  note: string;
};

/**
 * The gateway's public price list (`GET <origin>/api/pricing`, no key), as a lookup. A list that cannot
 * be read is not a failure of the run: the report prints without prices and says why.
 */
export async function loadPriceLookup(options: { baseUrl: string; fetch?: typeof fetch }): Promise<PriceLookup> {
  try {
    const catalog = await fetchPricingCatalog({
      baseURL: options.baseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    return {
      priceOf: (id) => priceLabelFor(catalog, id) ?? "not in the price list",
      note: `from the gateway's public price list (${catalog.models.length} models), at group ratio 1`,
    };
  } catch (error) {
    const why = error instanceof Error && error.message ? error.message : "unknown error";
    return { priceOf: undefined, note: `price list unavailable (${why.slice(0, 120)})` };
  }
}
