/**
 * The vocabulary of the tenant usage ledger (Phase 5 lane A,
 * `docs/internal/web-phase5-plans-billing-decisions.md` §4).
 *
 * Every gateway call a tenant makes leaves one row. A row always states **what** was consumed —
 * the unit and how many of it — even when nobody can price it yet, because an allowance that
 * cannot see a call is worse than one that sees it and says "unpriced": the first undercounts
 * silently, the second undercounts visibly. That is the whole reason `unpricedReason` exists
 * beside a nullable cost instead of the call simply not being recorded.
 *
 * Nothing here touches the network, a database or a clock. It is the shared type vocabulary plus
 * the two pure conversions; the store lives in `@agentforge/host`'s `tenant-usage.ts`.
 */

/**
 * The product surface the call was made from. This is a *metering* label, wider than `JobMode`:
 * it also covers chat, the edit agent and the three media studios, none of which are job modes.
 * `other` is the honest answer for a call site nobody has classified yet — it still gets a row.
 */
export const USAGE_MODES = [
  "chat",
  "documents",
  "presentations",
  "research",
  "data",
  "finance",
  "market",
  "legal",
  "knowledge",
  "images",
  "videos",
  "music",
  "edit",
  "other",
] as const;

export type UsageMode = (typeof USAGE_MODES)[number];

export function isUsageMode(value: unknown): value is UsageMode {
  return typeof value === "string" && (USAGE_MODES as readonly string[]).includes(value);
}

/**
 * What `quantity` counts. One row carries exactly one unit: a text run is metered in tokens, an
 * image in images, a clip in seconds, and a flat-rate call in jobs. They are deliberately not
 * reconciled into a single unit — only `costUsdMicros` is comparable across rows, and it is
 * nullable for exactly that reason.
 *
 * `jobs` is the unit for anything the gateway charges a flat rate per call for, whatever it hands
 * back: a music job is one charge and returns two takes, and a lyrics draft is one charge and
 * returns text. Counting either in takes or in words would bill the wrong thing.
 */
export const USAGE_UNITS = ["tokens", "images", "seconds", "jobs"] as const;

export type UsageUnit = (typeof USAGE_UNITS)[number];

export function isUsageUnit(value: unknown): value is UsageUnit {
  return typeof value === "string" && (USAGE_UNITS as readonly string[]).includes(value);
}

/**
 * Why a recorded row carries no cost. Each value is a different fix, which is the point of
 * keeping them apart rather than collapsing them to one `unpriced` flag:
 *
 * - `catalog_unavailable` — the gateway pricing catalog was not in cache at write time. The call
 *   is priceable; nothing has priced it yet. A later repricing pass closes these.
 * - `model_not_in_catalog` — the catalog was there and does not list the model. Either the
 *   catalog is stale or the model id is wrong; someone has to look.
 * - `tiered_billing` — the gateway prices this model by a tier expression the host cannot
 *   evaluate (`isUnpricedBilling`). No local pass will ever close these; the gateway's own
 *   metering is the only source.
 * - `no_list_price` — a media model nobody has transcribed a vendor list price for
 *   (`findMediaListPrice` miss). Closed by adding a row to `media-pricing.ts`.
 * - `usage_unknown` — the runtime reported a run it could not attribute token counts to
 *   (`RunUsageRecord.unknown`). The call happened; its size is unknown.
 */
export const UNPRICED_REASONS = [
  "catalog_unavailable",
  "model_not_in_catalog",
  "tiered_billing",
  "no_list_price",
  "usage_unknown",
] as const;

export type UnpricedReason = (typeof UNPRICED_REASONS)[number];

export function isUnpricedReason(value: unknown): value is UnpricedReason {
  return typeof value === "string" && (UNPRICED_REASONS as readonly string[]).includes(value);
}

/** One metered gateway call, before it is given an id and a timestamp by the store. */
export type UsageEvent = {
  mode: UsageMode;
  /** Gateway model id that actually answered, never the one that was asked for. */
  model: string;
  unit: UsageUnit;
  /** Tokens (input + output), images generated, or seconds of video. Never negative. */
  quantity: number;
  /** Only meaningful on a `tokens` row; both 0 elsewhere. */
  inputTokens: number;
  outputTokens: number;
  /** USD cost in micros, or `null` with a `unpricedReason` saying why nobody could price it. */
  costUsdMicros: number | null;
  unpricedReason?: UnpricedReason;
  /** The runtime run this call belongs to, where the caller knows it. */
  runId?: string;
};

/**
 * USD stored as an integer of millionths. The allowance is compared and decremented against this,
 * so it must not be a float: `0.1 + 0.2` is the classic way to bill someone the wrong number.
 * A micro is ~1/500th of the gateway's own quota unit (`QUOTA_PER_USD = 500_000`), so no gateway
 * price this catalog can express is lost to the rounding.
 */
export const USD_MICROS = 1_000_000;

/** USD → integer micros, rounded half away from zero. Non-finite or negative input is `null`. */
export function usdToMicros(usd: number | null | undefined): number | null {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) {
    return null;
  }
  return Math.round(usd * USD_MICROS);
}

/** Integer micros → USD, for display and for summing against a USD-denominated allowance. */
export function microsToUsd(micros: number | null | undefined): number {
  if (typeof micros !== "number" || !Number.isFinite(micros)) {
    return 0;
  }
  return micros / USD_MICROS;
}

/**
 * The metering label for a job run, derived from the `runPrefix` every job call site already
 * passes. Deriving beats adding a required argument at 20 call sites, and beats `JobMode`, which
 * five of those prefixes have no value for.
 *
 * Matched longest-prefix-first so `finance-ratios-buckets` does not fall through to `research`.
 */
export function usageModeFromRunPrefix(prefix: string): UsageMode {
  const id = typeof prefix === "string" ? prefix.trim().toLowerCase() : "";
  if (!id) {
    return "other";
  }
  // `document`, `document-section`; `presentation`, `presentation-slide`; and so on.
  if (id.startsWith("document")) {
    return "documents";
  }
  if (id.startsWith("presentation")) {
    return "presentations";
  }
  if (id.startsWith("research")) {
    return "research";
  }
  if (id.startsWith("finance")) {
    return "finance";
  }
  if (id.startsWith("market")) {
    return "market";
  }
  if (id.startsWith("legal")) {
    return "legal";
  }
  if (id.startsWith("knowledge")) {
    return "knowledge";
  }
  if (id.startsWith("data")) {
    return "data";
  }
  if (id.startsWith("music")) {
    return "music";
  }
  if (id.startsWith("edit")) {
    return "edit";
  }
  if (id.startsWith("chat")) {
    return "chat";
  }
  return "other";
}
