import {
  asRunUsageRecord,
  DEFAULT_GROUP_RATIO,
  estimateImageCost,
  estimateMusicCost,
  estimateVideoCost,
  explainRunUsd,
  findMediaListPrice,
  resolvedGatewayBaseUrl,
  usdToMicros,
  type MediaAspect,
  type PricingCatalog,
  type RunUsageRecord,
  type TenantContext,
  type UnpricedReason,
  type UsageEvent,
  type UsageMode,
} from "@agentforge/core";
import { cachedPricingCatalog } from "./account-usage";
import { gatewayFlatPrice } from "./media-price";
import { recordUsage, type TenantUsageRow } from "./tenant-usage";

/**
 * Pricing at write time, for the tenant usage ledger (Phase 5 lane A).
 *
 * Before this, USD was never persisted — it was recomputed per read from whatever catalog happened
 * to be cached, and a run the catalog could not price simply vanished from the sum. An allowance
 * cannot be enforced against that. So every call is priced once, here, at the moment it happens,
 * and the result — a number **or** a stated reason there is no number — is written with the row.
 *
 * Nothing in this module reaches the network. The token catalog is whatever is already in memory
 * (`cachedPricingCatalog` never fetches, by design: it sits on the studio hot path), and media
 * prices come from the repo's own transcribed list table. An uncached desk therefore records
 * `catalog_unavailable` rows rather than blocking a generation on a gateway round trip — those
 * rows keep their unit and quantity, so a later repricing pass can close them in place.
 */

/** Token catalog already in memory for the pinned gateway, or null. Never fetches. */
function tokenCatalog(): PricingCatalog | null {
  try {
    return cachedPricingCatalog(resolvedGatewayBaseUrl());
  } catch {
    // A desk with no resolvable gateway base URL prices nothing; it still records the call.
    return null;
  }
}

type Priced = { costUsdMicros: number | null; unpricedReason?: UnpricedReason };

function priced(usd: number | null, reason: UnpricedReason): Priced {
  const micros = usdToMicros(usd);
  return micros === null ? { costUsdMicros: null, unpricedReason: reason } : { costUsdMicros: micros };
}

/** Price one token run against the cached gateway catalog. */
export function priceTokenUsage(
  usage: RunUsageRecord,
  catalog: PricingCatalog | null,
  groupRatio = DEFAULT_GROUP_RATIO,
): Priced {
  if (!catalog) {
    return { costUsdMicros: null, unpricedReason: "catalog_unavailable" };
  }
  const estimate = explainRunUsd(usage, catalog, groupRatio);
  if (estimate.usd === null) {
    return { costUsdMicros: null, unpricedReason: estimate.reason };
  }
  return priced(estimate.usd, "catalog_unavailable");
}

/** Price `count` images of `model` at the repo's transcribed vendor list price. */
export function priceImageUsage(model: string, count: number, aspect?: MediaAspect): Priced {
  const price = findMediaListPrice(model);
  if (!price) {
    return { costUsdMicros: null, unpricedReason: "no_list_price" };
  }
  return priced(estimateImageCost(price, { count, ...(aspect ? { aspect } : {}) }).usd, "no_list_price");
}

/** Price one clip of `seconds` at the repo's transcribed per-second list price. */
export function priceVideoUsage(
  model: string,
  seconds: number,
  resolution?: "480p" | "720p" | "1080p" | "4k",
): Priced {
  const price = findMediaListPrice(model);
  if (!price) {
    return { costUsdMicros: null, unpricedReason: "no_list_price" };
  }
  return priced(estimateVideoCost(price, { seconds, ...(resolution ? { resolution } : {}) }).usd, "no_list_price");
}

/**
 * Price one stretch of audio sent to a recogniser, at a transcribed per-second list price.
 *
 * Nobody has transcribed one yet, so today this always returns `no_list_price` — which is the point:
 * the row still records how many seconds went through the gateway, and a single row in
 * `media-pricing.ts` closes every meeting at once. There is no gateway fallback either, because
 * `gatewayFlatPrice` only serves flat per-call rates and a flat rate is exactly wrong for audio that
 * is billed by the minute.
 */
export function priceSecondsUsage(model: string, seconds: number): Priced {
  const price = findMediaListPrice(model);
  if (price?.unit !== "second") {
    return { costUsdMicros: null, unpricedReason: "no_list_price" };
  }
  return priced(estimateVideoCost(price, { seconds }).usd, "no_list_price");
}

/**
 * Price one flat-rate gateway job (a music generation, a lyrics draft).
 *
 * Suno has no vendor list price at all — it sells a consumer subscription, not an API — so the only
 * figure that exists is the gateway's own per-call rate, which is exactly what `gatewayFlatPrice`
 * reads for the `track` unit. With no catalog in memory there is no number to have, and the row is
 * recorded as `catalog_unavailable` rather than `no_list_price`: one is fixable by a warm cache,
 * the other is not.
 */
export function priceJobUsage(model: string, count: number, catalog: PricingCatalog | null): Priced {
  const listed = findMediaListPrice(model);
  if (listed) {
    return priced(estimateMusicCost(listed, { count }).usd, "no_list_price");
  }
  if (!catalog) {
    return { costUsdMicros: null, unpricedReason: "catalog_unavailable" };
  }
  let flat = null;
  try {
    flat = gatewayFlatPrice(catalog, model, "track", resolvedGatewayBaseUrl());
  } catch {
    flat = null;
  }
  if (!flat) {
    return { costUsdMicros: null, unpricedReason: "no_list_price" };
  }
  return priced(estimateMusicCost(flat, { count }).usd, "no_list_price");
}

export type MusicUsageContext = {
  model: string;
  /** Flat-rate jobs, not takes: one music call is one charge however many takes come back. */
  count?: number;
  /** Catalog override, for tests. Defaults to whatever is cached for the pinned gateway. */
  catalog?: PricingCatalog | null;
  runId?: string;
};

/**
 * Record one music generation or one lyrics draft. The unit is `jobs`, because the gateway bills a
 * flat rate per call: a music job returns two takes for one charge, so counting takes would bill
 * double, and counting seconds of audio would bill something the gateway never charged for.
 */
export function recordMusicUsage(tenant: TenantContext, context: MusicUsageContext): TenantUsageRow | null {
  const count = Number.isFinite(context.count) && (context.count ?? 0) >= 1 ? Math.floor(context.count as number) : 1;
  const catalog = context.catalog === undefined ? tokenCatalog() : context.catalog;
  const event: UsageEvent = {
    mode: "music",
    model: context.model,
    unit: "jobs",
    quantity: count,
    inputTokens: 0,
    outputTokens: 0,
    ...priceJobUsage(context.model, count, catalog),
    ...(context.runId ? { runId: context.runId } : {}),
  };
  return recordUsage(tenant, event);
}

export type TokenUsageContext = {
  mode: UsageMode;
  runId?: string;
  /** Catalog override, for tests. Defaults to whatever is cached for the pinned gateway. */
  catalog?: PricingCatalog | null;
  groupRatio?: number;
};

/**
 * Record one text run: chat, documents, research, presentations, data, finance, market, legal,
 * knowledge or the edit agent. The unit is tokens, and the quantity is input + output — a run the
 * runtime could not attribute tokens to still lands, with `usage_unknown` and a quantity of 0.
 */
export function recordTokenUsage(
  tenant: TenantContext,
  usage: RunUsageRecord,
  context: TokenUsageContext,
): TenantUsageRow | null {
  const catalog = context.catalog === undefined ? tokenCatalog() : context.catalog;
  const event: UsageEvent = {
    mode: context.mode,
    model: usage.model,
    unit: "tokens",
    quantity: usage.inputTokens + usage.outputTokens,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...priceTokenUsage(usage, catalog, context.groupRatio),
    ...(context.runId ? { runId: context.runId } : {}),
  };
  return recordUsage(tenant, event);
}

export type ImageUsageContext = {
  model: string;
  count?: number;
  aspect?: MediaAspect;
  runId?: string;
};

/** Record one image generation. The unit is images; one call is one image today. */
export function recordImageUsage(tenant: TenantContext, context: ImageUsageContext): TenantUsageRow | null {
  const count = Number.isFinite(context.count) && (context.count ?? 0) >= 1 ? Math.floor(context.count as number) : 1;
  const event: UsageEvent = {
    mode: "images",
    model: context.model,
    unit: "images",
    quantity: count,
    inputTokens: 0,
    outputTokens: 0,
    ...priceImageUsage(context.model, count, context.aspect),
    ...(context.runId ? { runId: context.runId } : {}),
  };
  return recordUsage(tenant, event);
}

export type VideoUsageContext = {
  model: string;
  /** Clip length actually asked of the gateway, after `snapVideoSeconds`. */
  seconds: number;
  resolution?: "480p" | "720p" | "1080p" | "4k";
  runId?: string;
};

/** Record one video generation. The unit is seconds, because every list price here is per second. */
export function recordVideoUsage(tenant: TenantContext, context: VideoUsageContext): TenantUsageRow | null {
  const seconds = Number.isFinite(context.seconds) && context.seconds >= 1 ? context.seconds : 1;
  const event: UsageEvent = {
    mode: "videos",
    model: context.model,
    unit: "seconds",
    quantity: seconds,
    inputTokens: 0,
    outputTokens: 0,
    ...priceVideoUsage(context.model, seconds, context.resolution),
    ...(context.runId ? { runId: context.runId } : {}),
  };
  return recordUsage(tenant, event);
}

/**
 * Record a completed chat run against its tenant.
 *
 * `finished` is `finishRun`'s own return: it is true only for the call that actually transitioned
 * the `streaming` row. Gating on it is what stops the watchdog, the client abort and the model
 * completion from each writing their own row for one run.
 *
 * `runs.usage` is untouched and still carries the per-run detail on the run row. This is the
 * tenant-scoped ledger beside it, and chat appears in both on purpose — one is a property of a
 * run, the other is a billable event.
 */
export function recordChatRunUsage(
  tenant: TenantContext,
  runId: string,
  finished: boolean,
  usage: Record<string, unknown> | null,
): TenantUsageRow | null {
  if (!finished) {
    return null;
  }
  const record = asRunUsageRecord(usage);
  if (!record) {
    return null;
  }
  return recordTokenUsage(tenant, record, { mode: "chat", runId });
}

export type TranscriptionUsageContext = {
  model: string;
  /** Length of the audio handed to the recogniser, in seconds. */
  seconds: number;
  runId?: string;
};

/**
 * Record one meeting transcription. The unit is `seconds` of audio, which is what a recogniser
 * bills for — not the tokens of the transcript it hands back, and not the number of chunks the host
 * happened to split the recording into, which is an implementation detail of `extractMeetingAudio`
 * and would change the bill if `CHUNK_SECONDS` ever changed.
 *
 * The minutes and the translation that follow a transcription are ordinary token runs and are
 * metered by `rememberJobUsage` through their `meeting-minutes` / `meeting-translate` run prefixes.
 * All three land under the `meetings` mode with different units, the same way a video studio call
 * and its prompt do.
 */
export function recordTranscriptionUsage(
  tenant: TenantContext,
  context: TranscriptionUsageContext,
): TenantUsageRow | null {
  const raw = context.seconds;
  const seconds = Number.isFinite(raw) && raw >= 1 ? Math.ceil(raw) : 1;
  const event: UsageEvent = {
    mode: "meetings",
    model: context.model,
    unit: "seconds",
    quantity: seconds,
    inputTokens: 0,
    outputTokens: 0,
    ...priceSecondsUsage(context.model, seconds),
    ...(context.runId ? { runId: context.runId } : {}),
  };
  return recordUsage(tenant, event);
}
