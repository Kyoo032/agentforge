import {
  DEFAULT_GROUP_RATIO,
  findMediaListPrice,
  gatewayOriginFromBaseUrl,
  isUnpricedBilling,
  type ChatModel,
  type MediaPrice,
  type MediaPriceUnit,
  type PricingCatalog,
} from "@agentforge/core";

/** A studio model plus the list price the studio shows before the user generates. */
export type PricedStudioModel = ChatModel & { price: MediaPrice | null };

type GatewaySource = { url: string; vendor: string };

function gatewayPricingSource(baseURL: string | undefined): GatewaySource | null {
  try {
    const origin = gatewayOriginFromBaseUrl(baseURL);
    return { url: `${origin}/api/pricing`, vendor: new URL(origin).host };
  } catch {
    return null;
  }
}

/**
 * Flat per-call price from the gateway's own catalog, used only when nobody has transcribed a vendor
 * list price. `quotaType === 1` is the gateway's "one fixed charge per call" mode, which lines up with
 * one image and with one music job — it does **not** line up with a per-second video rate, so video
 * models get no gateway fallback rather than a number that would be wrong once the clip length changes.
 *
 * For music this is the only price there will ever be: Suno publishes no API rate card, so a `track`
 * row with no gateway figure is honestly "no list price on file" rather than a guess.
 */
export function gatewayFlatPrice(
  catalog: PricingCatalog,
  modelId: string,
  unit: MediaPriceUnit,
  baseURL: string | undefined,
  now: Date = new Date(),
): MediaPrice | null {
  if (unit !== "image" && unit !== "track") {
    return null;
  }
  const source = gatewayPricingSource(baseURL);
  if (!source) {
    return null;
  }
  const needle = modelId.trim().toLowerCase();
  const entry = catalog.models.find((item) => item.modelName.toLowerCase() === needle);
  if (entry?.quotaType !== 1 || entry.modelPrice <= 0 || isUnpricedBilling(entry)) {
    return null;
  }
  const usd = entry.modelPrice * DEFAULT_GROUP_RATIO;
  if (!Number.isFinite(usd) || usd <= 0) {
    return null;
  }
  return {
    vendor: source.vendor,
    unit,
    tiers: { default: usd },
    defaultTier: "default",
    source: source.url,
    checkedAt: now.toISOString().slice(0, 10),
    confidence: "medium",
    origin: "gateway",
    note: "Flat per-call price from the gateway catalog, not the model vendor's list price.",
  };
}

/** Copy of the model list with a `price` on each row. Never mutates the input models. */
export function attachMediaPrices(
  models: readonly ChatModel[],
  unit: MediaPriceUnit,
  catalog: PricingCatalog | null,
  baseURL?: string,
  now: Date = new Date(),
): PricedStudioModel[] {
  return models.map((model) => ({
    ...model,
    price: findMediaListPrice(model.id) ?? (catalog ? gatewayFlatPrice(catalog, model.id, unit, baseURL, now) : null),
  }));
}
