/**
 * Curated list prices for image and video generation, so a studio can show a cost before it spends.
 *
 * These are the **model provider's own list prices in USD**. The gateway bills its own rate — currently
 * below list — so anything built on this table is a comparison aid, never an invoice.
 *
 * Truthfulness rules, because these strings reach the UI verbatim:
 * - `source` is an `https://` vendor page **only** when that page carries the figure. Everything else is
 *   a non-URL marker (`repo:…`, `thirdparty:…`) and must also set `citation`, so the UI can say
 *   "third-party figure" instead of "vendor list price".
 * - `confidence: "low"` means nobody has a page for it at all; such a row is shown as an unverified
 *   estimate and does not claim a vendor, so its `vendor` may be empty.
 * - `checkedAt` is the day the row was last reviewed against whatever its `source` names — not a promise
 *   that a vendor page was read on that day.
 *
 * No Node-only imports: the renderer loads this module through the `@agentforge/core/media-pricing`
 * subpath. Full table with sources: `docs/internal/research/media-pricing.md`.
 */

export type MediaPriceTier = "default" | "low" | "medium" | "high" | "480p" | "720p" | "1080p" | "4k";

export type MediaPriceUnit = "image" | "second";

export type MediaPriceConfidence = "high" | "medium" | "low";

export type MediaPriceOrigin = "list" | "gateway";

export type MediaAspect = "square" | "landscape" | "portrait";

/** Price multiplier for one aspect. `exact` is false when the underlying ratio moves between tiers. */
export type AspectMultiplier = {
  factor: number;
  exact: boolean;
};

export type MediaPrice = {
  /** Empty only on an unverified row that does not claim a vendor. */
  vendor: string;
  unit: MediaPriceUnit;
  tiers: Partial<Record<MediaPriceTier, number>>;
  defaultTier: MediaPriceTier;
  /** `https://…` vendor page that carries the figure, or a `repo:` / `thirdparty:` marker. */
  source: string;
  /** Required whenever `source` is not a vendor URL: says where the figure actually came from. */
  citation?: string;
  /** ISO `YYYY-MM-DD` of the day this row was last reviewed against its source. */
  checkedAt: string;
  confidence: MediaPriceConfidence;
  origin: MediaPriceOrigin;
  /** Set on rows whose per-image price scales with canvas size (OpenAI's token-priced images). */
  aspectMultipliers?: Partial<Record<MediaAspect, AspectMultiplier>>;
  note?: string;
};

export type MediaEstimate = {
  usd: number;
  perUnitUsd: number;
  unit: MediaPriceUnit;
  tier: MediaPriceTier;
  /** A neighbouring tier or an inexact aspect multiplier was used; the UI softens the number. */
  approx: boolean;
  confidence: MediaPriceConfidence;
  vendor: string;
  source: string;
  citation?: string;
  checkedAt: string;
  origin: MediaPriceOrigin;
};

export type MediaCostTier = "cheapest" | "cheap" | "mid" | "premium";

export type MediaPriceEntry = {
  /** Gateway ids this entry is the canonical price for. */
  ids: readonly string[];
  /** Alias matcher, tried in table order once the exact lookup misses. */
  pattern: RegExp;
  price: MediaPrice;
};

const OPENAI_PRICING = "https://developers.openai.com/api/docs/pricing";
const GOOGLE_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";
const XAI_PRICING = "https://docs.x.ai/developers/pricing";

/** Not a URL on purpose: a private-repo link must not ship inside an API payload. */
const REPO_DOC = "repo:docs/internal/gateway-model-selection.md";
const MODELARK_THIRDPARTY = "thirdparty:byteplus-modelark-rate-card";
const COMETAPI_THIRDPARTY = "thirdparty:cometapi-citing-byteplus";

const MODELARK_CITATION = "BytePlus ModelArk rate card, read through a reseller listing, not the vendor page";
const COMETAPI_CITATION = "CometAPI citing BytePlus, not the vendor page";
const REPO_CITATION = "docs/internal/gateway-model-selection.md, transcribed from vendor announcements";

const CHECKED = "2026-09-15";

/** Per-image token-derived note shared by the OpenAI rows. */
const OPENAI_DERIVED =
  "Per-image USD derived from the output-token price at 1024x1024 (272 low / 1056 medium / 4160 high tokens).";

/**
 * OpenAI bills image output per token and a taller or wider canvas costs more tokens. From OpenAI's
 * published token table: portrait 1024x1536 is exactly 1.5x square at every quality (408/272,
 * 1584/1056, 6240/4160); landscape 1536x1024 drifts (400/272 = 1.471, 1568/1056 = 1.485,
 * 6208/4160 = 1.492), so 1.48 is the mid-point and the estimate is flagged approximate.
 */
const OPENAI_ASPECTS: Partial<Record<MediaAspect, AspectMultiplier>> = {
  square: { factor: 1, exact: true },
  portrait: { factor: 1.5, exact: true },
  landscape: { factor: 1.48, exact: false },
};

/**
 * Ordered price table. The first pattern that matches wins, so a narrower id (`-fast`, `-mini`,
 * `-1.5-preview`) must sit above the family it belongs to.
 */
const ENTRIES: MediaPriceEntry[] = [
  // ---------------------------------------------------------------- images
  {
    ids: ["gpt-image-1-mini"],
    pattern: /^gpt-image-1-mini/i,
    price: {
      vendor: "OpenAI",
      unit: "image",
      tiers: { medium: 0.008 },
      defaultTier: "medium",
      source: OPENAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      aspectMultipliers: OPENAI_ASPECTS,
      note: OPENAI_DERIVED,
    },
  },
  {
    ids: ["gpt-image-1"],
    pattern: /^gpt-image-1(?![\d.])/i,
    price: {
      vendor: "OpenAI",
      unit: "image",
      tiers: { low: 0.011, medium: 0.042, high: 0.167 },
      defaultTier: "medium",
      source: OPENAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      aspectMultipliers: OPENAI_ASPECTS,
      note: OPENAI_DERIVED,
    },
  },
  {
    ids: ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2-count"],
    pattern: /^gpt-image-2/i,
    price: {
      vendor: "OpenAI",
      unit: "image",
      tiers: { low: 0.008, medium: 0.032, high: 0.125 },
      defaultTier: "medium",
      source: OPENAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      aspectMultipliers: OPENAI_ASPECTS,
      note: OPENAI_DERIVED,
    },
  },
  {
    ids: ["gemini-3.1-flash-lite-image"],
    pattern: /^gemini-3[._-]1-flash-lite-image/i,
    price: {
      vendor: "Google",
      unit: "image",
      tiers: { default: 0.0336 },
      defaultTier: "default",
      source: GOOGLE_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      note: "1K output only.",
    },
  },
  {
    ids: ["nano-banana-pro"],
    pattern: /^(nano-banana-pro|gemini-3-pro-image)/i,
    price: {
      vendor: "Google",
      unit: "image",
      tiers: { default: 0.134 },
      defaultTier: "default",
      source: GOOGLE_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      note: "1K-2K output. Google's 4K tier ($0.24) is not modelled: the studio has no output-size control.",
    },
  },
  {
    ids: ["nano-banana-2"],
    pattern: /^(nano-banana-2|gemini-3[._-]1-flash-image)/i,
    price: {
      vendor: "Google",
      unit: "image",
      tiers: { default: 0.067 },
      defaultTier: "default",
      source: GOOGLE_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      note: "1K output. Google's 4K tier ($0.151) is not modelled: the studio has no output-size control.",
    },
  },
  {
    ids: ["nano-banana"],
    pattern: /^(nano-banana$|gemini-2[._-]5-flash-image)/i,
    price: {
      vendor: "Google",
      unit: "image",
      tiers: { default: 0.039 },
      defaultTier: "default",
      source: GOOGLE_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
    },
  },
  {
    ids: ["seedream-4.5"],
    pattern: /^(seedream-4[._-]5|doubao-seedream-4-5)/i,
    price: {
      vendor: "ByteDance",
      unit: "image",
      tiers: { default: 0.04 },
      defaultTier: "default",
      source: MODELARK_THIRDPARTY,
      citation: MODELARK_CITATION,
      checkedAt: CHECKED,
      confidence: "medium",
      origin: "list",
    },
  },
  {
    ids: ["seedream-4.0"],
    pattern: /^(seedream-4[._-]0|doubao-seedream-4-0)/i,
    price: {
      vendor: "ByteDance",
      unit: "image",
      tiers: { default: 0.03 },
      defaultTier: "default",
      source: MODELARK_THIRDPARTY,
      citation: MODELARK_CITATION,
      checkedAt: CHECKED,
      confidence: "medium",
      origin: "list",
    },
  },
  {
    ids: ["grok-imagine-image-quality"],
    pattern: /^grok-imagine-image-quality/i,
    price: {
      vendor: "xAI",
      unit: "image",
      tiers: { default: 0.05 },
      defaultTier: "default",
      source: XAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
    },
  },
  {
    ids: ["grok-imagine-image-2.0"],
    pattern: /^grok-imagine-image-2/i,
    price: {
      vendor: "xAI",
      unit: "image",
      tiers: { default: 0.04 },
      defaultTier: "default",
      source: XAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
    },
  },
  {
    ids: ["grok-imagine-image"],
    pattern: /^grok-imagine-image/i,
    price: {
      vendor: "xAI",
      unit: "image",
      tiers: { default: 0.02 },
      defaultTier: "default",
      source: XAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
    },
  },
  // ---------------------------------------------------------------- videos
  {
    ids: ["veo-3.1-lite"],
    pattern: /^veo[._-]?3[._-]1[._-]lite/i,
    price: {
      vendor: "Google",
      unit: "second",
      tiers: { "720p": 0.05 },
      defaultTier: "720p",
      source: GOOGLE_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
    },
  },
  {
    ids: ["veo_3_1-fast"],
    pattern: /^veo[._-]?3[._-]1[._-]fast/i,
    price: {
      vendor: "Google",
      unit: "second",
      tiers: { "720p": 0.1, "4k": 0.3 },
      defaultTier: "720p",
      source: GOOGLE_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
    },
  },
  {
    ids: ["veo_3_1"],
    pattern: /^veo[._-]?3[._-]1/i,
    price: {
      vendor: "Google",
      unit: "second",
      tiers: { "720p": 0.4, "1080p": 0.4, "4k": 0.6 },
      defaultTier: "720p",
      source: GOOGLE_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      note: "720p and 1080p bill the same, audio included.",
    },
  },
  {
    ids: ["grok-imagine-video-1.5-preview"],
    pattern: /^grok-imagine-video-1[._-]5/i,
    price: {
      vendor: "xAI",
      unit: "second",
      tiers: { "480p": 0.08, "720p": 0.14, "1080p": 0.25 },
      defaultTier: "720p",
      source: XAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
    },
  },
  {
    ids: ["grok-imagine-video"],
    pattern: /^grok-imagine-video/i,
    price: {
      vendor: "xAI",
      unit: "second",
      tiers: { "480p": 0.05, "720p": 0.07 },
      defaultTier: "720p",
      source: XAI_PRICING,
      checkedAt: CHECKED,
      confidence: "high",
      origin: "list",
      note: "No 1080p tier upstream.",
    },
  },
  {
    ids: ["seedance-2.5"],
    pattern: /^(seedance-2[._-]5|(doubao|dreamina)-seedance-2-5)/i,
    price: {
      vendor: "ByteDance",
      unit: "second",
      tiers: { "480p": 0.103, "720p": 0.231 },
      defaultTier: "720p",
      source: COMETAPI_THIRDPARTY,
      citation: COMETAPI_CITATION,
      checkedAt: CHECKED,
      confidence: "medium",
      origin: "list",
      note: "1080p tier not published yet; a 1080p clip falls back to the 720p rate.",
    },
  },
  {
    ids: ["seedance-2.0-fast"],
    pattern: /^(seedance-2[._-]0[._-]fast|(doubao|dreamina)-seedance-2-0-fast)/i,
    price: {
      vendor: "ByteDance",
      unit: "second",
      tiers: { "480p": 0.06, "720p": 0.12, "1080p": 0.3 },
      defaultTier: "720p",
      source: MODELARK_THIRDPARTY,
      citation: MODELARK_CITATION,
      checkedAt: CHECKED,
      confidence: "medium",
      origin: "list",
      note: "1080p derived from the repo note that fast runs about 20% below 2.0.",
    },
  },
  {
    ids: ["seedance-2.0-mini"],
    pattern: /^(seedance-2[._-]0[._-]mini|(doubao|dreamina)-seedance-2-0-mini)/i,
    price: {
      vendor: "ByteDance",
      unit: "second",
      tiers: { "480p": 0.04, "720p": 0.08, "1080p": 0.185 },
      defaultTier: "720p",
      source: MODELARK_THIRDPARTY,
      citation: MODELARK_CITATION,
      checkedAt: CHECKED,
      confidence: "medium",
      origin: "list",
      note: "1080p derived from the repo note that mini runs about 50% below 2.0.",
    },
  },
  {
    ids: ["seedance-2.0"],
    pattern: /^(seedance-2[._-]0|(doubao|dreamina)-seedance-2-0)/i,
    price: {
      vendor: "ByteDance",
      unit: "second",
      tiers: { "480p": 0.07, "720p": 0.15, "1080p": 0.37, "4k": 0.78 },
      defaultTier: "720p",
      source: MODELARK_THIRDPARTY,
      citation: MODELARK_CITATION,
      checkedAt: CHECKED,
      confidence: "medium",
      origin: "list",
    },
  },
  {
    ids: ["happyhorse-1.1-i2v"],
    pattern: /^happyhorse-1[._-]1-i2v/i,
    price: {
      vendor: "Alibaba",
      unit: "second",
      tiers: { "720p": 0.14, "1080p": 0.18 },
      defaultTier: "720p",
      source: REPO_DOC,
      citation: REPO_CITATION,
      checkedAt: CHECKED,
      confidence: "medium",
      origin: "list",
    },
  },
  {
    // No vendor claim: the model behind these ids is not identified, so nothing is attributed.
    ids: ["omni-fast", "omni-fast-v2v"],
    pattern: /^omni-fast/i,
    price: {
      vendor: "",
      unit: "second",
      tiers: { "720p": 0.1 },
      defaultTier: "720p",
      source: REPO_DOC,
      citation: REPO_CITATION,
      checkedAt: CHECKED,
      confidence: "low",
      origin: "list",
      note: "Unidentified model; the best hypothesis is Google Gemini Omni Flash and the rate is unverified.",
    },
  },
];

function freezeEntry(entry: MediaPriceEntry): MediaPriceEntry {
  Object.freeze(entry.price.tiers);
  if (entry.price.aspectMultipliers) {
    for (const multiplier of Object.values(entry.price.aspectMultipliers)) {
      Object.freeze(multiplier);
    }
    Object.freeze(entry.price.aspectMultipliers);
  }
  Object.freeze(entry.price);
  Object.freeze(entry.ids);
  return Object.freeze(entry);
}

/** Frozen so a caller cannot edit the shared rows it is handed. */
export const MEDIA_PRICE_ENTRIES: readonly MediaPriceEntry[] = Object.freeze(ENTRIES.map(freezeEntry));

const EXACT_INDEX: ReadonlyMap<string, MediaPrice> = new Map(
  MEDIA_PRICE_ENTRIES.flatMap((entry) => entry.ids.map((id) => [id.toLowerCase(), entry.price] as const)),
);

/** Quality tiers, cheapest first. */
const QUALITY_ORDER: readonly MediaPriceTier[] = ["low", "medium", "high"];
/** Resolution tiers, smallest first. */
const RESOLUTION_ORDER: readonly MediaPriceTier[] = ["480p", "720p", "1080p", "4k"];

/** List price for a gateway model id, or `null` when nobody has transcribed one yet. */
export function findMediaListPrice(modelId: string): MediaPrice | null {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) {
    return null;
  }
  const exact = EXACT_INDEX.get(id.toLowerCase());
  if (exact) {
    return exact;
  }
  const matched = MEDIA_PRICE_ENTRIES.find((entry) => entry.pattern.test(id));
  return matched ? matched.price : null;
}

function tiersFor(price: MediaPrice, order: readonly MediaPriceTier[]): MediaPriceTier[] {
  return order.filter((tier) => typeof price.tiers[tier] === "number");
}

/** Asked-for tier, else the nearest published one (lower first), else whatever the table has. */
function resolveTier(
  price: MediaPrice,
  wanted: MediaPriceTier | undefined,
  order: readonly MediaPriceTier[],
): { tier: MediaPriceTier; approx: boolean } {
  if (wanted && typeof price.tiers[wanted] === "number") {
    return { tier: wanted, approx: false };
  }
  const available = tiersFor(price, order);
  if (wanted) {
    const wantedAt = order.indexOf(wanted);
    if (wantedAt >= 0 && available.length > 0) {
      const lower = available.filter((tier) => order.indexOf(tier) < wantedAt).pop();
      const higher = available.find((tier) => order.indexOf(tier) > wantedAt);
      const fallback = lower ?? higher;
      if (fallback) {
        return { tier: fallback, approx: true };
      }
    }
  }
  if (typeof price.tiers[price.defaultTier] === "number") {
    // A flat single-price row is not approximate just because a tier was asked for: it has no tiers.
    return { tier: price.defaultTier, approx: Boolean(wanted) && available.length > 0 };
  }
  const first = (Object.keys(price.tiers) as MediaPriceTier[])[0];
  return { tier: first ?? price.defaultTier, approx: true };
}

function estimateFrom(
  price: MediaPrice,
  tier: MediaPriceTier,
  approx: boolean,
  units: number,
  perUnitUsd: number,
): MediaEstimate {
  return {
    usd: perUnitUsd * units,
    perUnitUsd,
    unit: price.unit,
    tier,
    approx,
    confidence: price.confidence,
    vendor: price.vendor,
    source: price.source,
    ...(price.citation ? { citation: price.citation } : {}),
    checkedAt: price.checkedAt,
    origin: price.origin,
  };
}

export type ImageCostOptions = {
  count?: number;
  quality?: "low" | "medium" | "high";
  /** A taller/wider canvas costs more on token-priced rows; ignored where the vendor bills per image. */
  aspect?: MediaAspect;
};

/** Cost of `count` images at the model's list price. Pure: nothing here touches `price`. */
export function estimateImageCost(price: MediaPrice, options: ImageCostOptions = {}): MediaEstimate {
  const raw = options.count ?? 1;
  const count = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
  const { tier, approx } = resolveTier(price, options.quality, QUALITY_ORDER);
  const multiplier = options.aspect ? price.aspectMultipliers?.[options.aspect] : undefined;
  const factor = multiplier?.factor ?? 1;
  const perUnitUsd = (price.tiers[tier] ?? 0) * factor;
  return estimateFrom(price, tier, approx || multiplier?.exact === false, count, perUnitUsd);
}

export type VideoCostOptions = {
  seconds: number;
  resolution?: "480p" | "720p" | "1080p" | "4k";
};

/** Cost of one clip: per-second list price times the clip length. */
export function estimateVideoCost(price: MediaPrice, options: VideoCostOptions): MediaEstimate {
  const raw = options.seconds;
  const seconds = Number.isFinite(raw) && raw >= 1 ? raw : 1;
  const { tier, approx } = resolveTier(price, options.resolution, RESOLUTION_ORDER);
  return estimateFrom(price, tier, approx, seconds, price.tiers[tier] ?? 0);
}

/** Where one price sits in the set on screen. Cheapest = the minimum; then 1.5x, then 4x. */
export function costTier(usd: number, usds: readonly number[]): MediaCostTier {
  const priced = usds.filter((value) => Number.isFinite(value) && value > 0);
  if (!Number.isFinite(usd) || usd <= 0 || priced.length === 0) {
    return "mid";
  }
  const min = Math.min(...priced);
  if (usd <= min) {
    return "cheapest";
  }
  if (usd <= min * 1.5) {
    return "cheap";
  }
  if (usd <= min * 4) {
    return "mid";
  }
  return "premium";
}

/**
 * Size of the gap between two prices, always >= 1 and rounded for copy ("about 4x cheaper than ...").
 * Returns 0 when either side has no usable price, so callers can skip the sentence.
 */
export function relativeFactor(usd: number, referenceUsd: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(referenceUsd) || usd <= 0 || referenceUsd <= 0) {
    return 0;
  }
  const ratio = usd >= referenceUsd ? usd / referenceUsd : referenceUsd / usd;
  return ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
}
