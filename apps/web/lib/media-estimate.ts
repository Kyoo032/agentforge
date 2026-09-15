import { formatUsd } from "@agentforge/core/gateway";
import {
  costTier,
  estimateImageCost,
  estimateVideoCost,
  relativeFactor,
  type MediaAspect,
  type MediaCostTier,
  type MediaEstimate,
  type MediaPrice,
} from "@agentforge/core/media-pricing";
import { getLocale, t } from "./i18n";

/** A studio model row as the host sends it, with the price the studio shows before generating. */
export type PricedModel = {
  id: string;
  label?: string;
  price?: MediaPrice | null;
};

export type MediaEstimateView = {
  /** One line under the controls row, already translated. */
  line: string;
  /** "About 4x cheaper than ..." / "The cheapest image model here", or null when there is nothing to say. */
  compare: string | null;
  tier: MediaCostTier | null;
  /** No list price on file for the selected model. */
  unknown: boolean;
  /** Low-confidence source: the number is softened with "~" and marked unverified. */
  unverified: boolean;
};

export type VideoResolution = "480p" | "720p" | "1080p";

export type ImageEstimateInput = {
  model: string;
  models: readonly PricedModel[];
  /** Moves the price on OpenAI's token-priced rows; ignored where the vendor bills per image. */
  aspect?: MediaAspect;
  quality?: "low" | "medium" | "high";
};

export type VideoEstimateInput = {
  model: string;
  models: readonly PricedModel[];
  seconds: number;
  resolution?: VideoResolution;
};

type Peer = { id: string; usd: number; approx: boolean };

const SEPARATOR = " · ";
/** Prefix for an exact figure; a softened one uses "~" instead, never both. */
const ABOUT = "≈ ";
const SOFT = "~";
const QUALITY_TIERS = new Set(["low", "medium", "high"]);

function localeTag(): string {
  return getLocale() === "id" ? "id-ID" : "en-US";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(localeTag()).format(value);
}

function priceOf(models: readonly PricedModel[], id: string): MediaPrice | null {
  return models.find((model) => model.id === id)?.price ?? null;
}

function nameOf(models: readonly PricedModel[], id: string): string {
  const model = models.find((item) => item.id === id);
  return model?.label?.trim() || id;
}

function formatCheckedAt(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(localeTag(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Says where the number came from, and never claims more than the row can back:
 * a low-confidence row has no vendor page at all, a `citation` row is somebody else's transcription,
 * and only a real vendor URL earns the words "list price".
 */
function sourceLine(namespace: "images" | "videos", estimate: MediaEstimate): string {
  const date = formatCheckedAt(estimate.checkedAt);
  if (estimate.confidence === "low") {
    return t(`${namespace}.estimate.sourceUnverified`);
  }
  if (estimate.origin === "gateway") {
    return t(`${namespace}.estimate.sourceGateway`, { date });
  }
  if (estimate.citation) {
    return t(`${namespace}.estimate.sourceThirdParty`, { vendor: estimate.vendor, date });
  }
  return t(`${namespace}.estimate.source`, { vendor: estimate.vendor, date });
}

/** Every priced peer in the list, costed against the same studio state, so the tier word is comparable. */
function peerCosts(models: readonly PricedModel[], cost: (price: MediaPrice) => MediaEstimate): Peer[] {
  return models.flatMap((model) => {
    if (!model.price) {
      return [];
    }
    const estimate = cost(model.price);
    return [{ id: model.id, usd: estimate.usd, approx: estimate.approx || estimate.confidence === "low" }];
  });
}

/**
 * The comparison sentence. It is softened with "~" whenever the peer it names was itself estimated
 * from a fallback tier or an unverified row — otherwise "1.6x cheaper than seedance-2.0" would read
 * as fact while resting on a price nobody published.
 */
function compareLine(
  namespace: "images" | "videos",
  models: readonly PricedModel[],
  peers: readonly Peer[],
  self: MediaEstimate,
): string | null {
  const others = peers.filter((peer) => peer.usd > 0);
  if (self.usd <= 0 || others.length < 2) {
    return null;
  }
  const cheapest = others.reduce((best, peer) => (peer.usd < best.usd ? peer : best));
  const dearest = others.reduce((best, peer) => (peer.usd > best.usd ? peer : best));
  if (self.usd <= cheapest.usd) {
    return t(`${namespace}.estimate.compareCheapest`);
  }
  const against = self.usd >= dearest.usd ? cheapest : dearest;
  const key = self.usd >= dearest.usd ? "compareMore" : "compareCheaper";
  const factor = relativeFactor(self.usd, against.usd);
  if (factor <= 1) {
    return null;
  }
  const sentence = t(`${namespace}.estimate.${key}`, {
    factor: formatNumber(factor),
    model: nameOf(models, against.id),
  });
  return against.approx || self.approx ? `${SOFT}${sentence}` : sentence;
}

function unknownView(namespace: "images" | "videos"): MediaEstimateView {
  return { line: t(`${namespace}.estimate.unknown`), compare: null, tier: null, unknown: true, unverified: false };
}

function assemble(
  namespace: "images" | "videos",
  estimate: MediaEstimate,
  head: string,
  extras: string[],
  models: readonly PricedModel[],
  peers: readonly Peer[],
): MediaEstimateView {
  const unverified = estimate.confidence === "low";
  const marker = unverified || estimate.approx ? SOFT : ABOUT;
  const tier = costTier(
    estimate.usd,
    peers.map((peer) => peer.usd),
  );
  const parts = [
    `${marker}${head}`,
    ...extras,
    sourceLine(namespace, estimate),
    t(`${namespace}.estimate.tier.${tier}`),
  ];
  if (unverified) {
    parts.push(t(`${namespace}.estimate.unverified`));
  }
  return {
    line: parts.join(SEPARATOR),
    compare: compareLine(namespace, models, peers, estimate),
    tier,
    unknown: false,
    unverified,
  };
}

export function imageEstimateView(input: ImageEstimateInput): MediaEstimateView {
  const price = priceOf(input.models, input.model);
  if (!price) {
    return unknownView("images");
  }
  const cost = (candidate: MediaPrice): MediaEstimate =>
    estimateImageCost(candidate, { quality: input.quality, aspect: input.aspect });
  const estimate = cost(price);
  const head = t("images.estimate.perImage", { usd: formatUsd(estimate.usd) });
  const extras = QUALITY_TIERS.has(estimate.tier)
    ? [t("images.estimate.atQuality", { quality: t(`images.estimate.quality.${estimate.tier}`) })]
    : [];
  return assemble("images", estimate, head, extras, input.models, peerCosts(input.models, cost));
}

export function videoEstimateView(input: VideoEstimateInput): MediaEstimateView {
  const price = priceOf(input.models, input.model);
  if (!price) {
    return unknownView("videos");
  }
  const cost = (candidate: MediaPrice): MediaEstimate =>
    estimateVideoCost(candidate, { seconds: input.seconds, resolution: input.resolution });
  const estimate = cost(price);
  const head = t("videos.estimate.forClip", {
    usd: formatUsd(estimate.usd),
    seconds: formatNumber(input.seconds),
    resolution: estimate.tier,
  });
  const extras = [t("videos.estimate.perSecond", { usd: formatUsd(estimate.perUnitUsd) })];
  return assemble("videos", estimate, head, extras, input.models, peerCosts(input.models, cost));
}

/** Short price tag for the model picker: "$0.03/img" or "$0.12/s". */
export function mediaPriceHint(namespace: "images" | "videos", price: MediaPrice | null | undefined): string | null {
  const usd = price ? price.tiers[price.defaultTier] : undefined;
  if (!price || typeof usd !== "number" || usd <= 0) {
    return null;
  }
  return t(`${namespace}.estimate.hint`, { usd: formatUsd(usd) });
}

/** Model id → picker hint, for every row that has a price. */
export function mediaPriceHints(
  namespace: "images" | "videos",
  models: readonly PricedModel[],
): Record<string, string> {
  const pairs = models.flatMap((model) => {
    const hint = mediaPriceHint(namespace, model.price);
    return hint ? [[model.id, hint] as const] : [];
  });
  return Object.fromEntries(pairs);
}
