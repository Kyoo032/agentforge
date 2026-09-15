import {
  asRunUsageRecord,
  buildUsageBuckets,
  estimateDeskByModel,
  estimateDeskUsd,
  fetchPricingCatalog,
  formatUsd,
  listUsageBucketFrames,
  loadThisKeyState,
  summarizeUsageDesk,
  usageBucketKey,
  type DeskModelSpend,
  type PricingCatalog,
  type RunUsageRecord,
  type StoredSecrets,
  type ThisKeyState,
  type TimestampedRunUsage,
  type UsageBucket,
  redactSecrets,
  resolveProviderKeys,
  type UsageRange,
} from "@agentforge/core";
import type { TenantContext } from "@agentforge/core";
import { createHash } from "node:crypto";
import { listDeskUsage, listTimedDeskUsage } from "./desk-usage";
import { listRunUsage } from "./threads";

const PRICING_TTL_MS = 10 * 60 * 1000;
const THIS_KEY_TTL_MS = 2 * 60 * 1000;

let pricingCache: { at: number; baseURL: string; catalog: PricingCatalog } | null = null;
let thisKeyCache: { at: number; id: string; state: ThisKeyState } | null = null;

/**
 * The gateway key travels on every call below, so the endpoint must be the pinned one and never the
 * owner-stored `openaiBaseUrl`: `resolveProviderKeys` is the single place that decides it.
 */
function gatewayBaseUrlFor(settings: StoredSecrets): string | undefined {
  return resolveProviderKeys(settings).openaiBaseUrl;
}

function thisKeyCacheId(baseURL: string | undefined, apiKey: string | undefined): string {
  const key = apiKey?.trim() ?? "";
  const url = baseURL?.trim() ?? "";
  if (!key) {
    return `${url}::needs_key`;
  }
  return `${url}::${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

export function clearThisKeyCache(): void {
  thisKeyCache = null;
}

async function thisKeyFor(settings: StoredSecrets): Promise<ThisKeyState> {
  const baseURL = gatewayBaseUrlFor(settings);
  const id = thisKeyCacheId(baseURL, settings.openaiApiKey);
  if (thisKeyCache && thisKeyCache.id === id && Date.now() - thisKeyCache.at < THIS_KEY_TTL_MS) {
    return thisKeyCache.state;
  }
  const state = await loadThisKeyState({
    baseURL,
    apiKey: settings.openaiApiKey,
  });
  thisKeyCache = { at: Date.now(), id, state };
  return state;
}

export type DeskModelSpendPayload = {
  model: string;
  usd: number;
  display: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  unknown: boolean;
};

export type AccountUsagePayload = {
  thisKey: ThisKeyState;
  desk: {
    usd: number;
    display: string;
    unknownCount: number;
    pricedCount: number;
    byModel: DeskModelSpendPayload[];
    error?: string;
  };
};

export type RangeUsagePayload = {
  range: UsageRange;
  thisKey: ThisKeyState;
  desk: {
    usd: number;
    display: string;
    unknownCount: number;
    pricedCount: number;
    modelCount: number;
    byModel: DeskModelSpendPayload[];
    error?: string;
  };
  buckets: UsageBucket[];
};

function serializeByModel(rows: DeskModelSpend[]): DeskModelSpendPayload[] {
  return rows.map((row) => ({
    model: row.model,
    usd: row.usd,
    display: row.usd > 0 ? formatUsd(row.usd) : row.unknown ? "—" : formatUsd(0),
    runCount: row.runCount,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    unknown: row.unknown,
  }));
}

/** A failed pricing fetch is remembered too, so an offline desk pays the timeout once, not per request. */
const PRICING_FAIL_TTL_MS = 2 * 60 * 1000;
let pricingFailure: { at: number; baseURL: string; error: unknown } | null = null;

async function pricingFor(baseURL: string | undefined): Promise<PricingCatalog> {
  const key = baseURL?.trim() || "";
  if (pricingCache && pricingCache.baseURL === key && Date.now() - pricingCache.at < PRICING_TTL_MS) {
    return pricingCache.catalog;
  }
  if (pricingFailure && pricingFailure.baseURL === key && Date.now() - pricingFailure.at < PRICING_FAIL_TTL_MS) {
    throw pricingFailure.error;
  }
  try {
    const catalog = await fetchPricingCatalog({ baseURL });
    pricingCache = { at: Date.now(), baseURL: key, catalog };
    pricingFailure = null;
    return catalog;
  } catch (error) {
    pricingFailure = { at: Date.now(), baseURL: key, error };
    throw error;
  }
}

/**
 * Catalog already in memory, or null. Never fetches: the studio model lists call this on a hot path and
 * must not wait on the gateway, so an uncached desk simply shows no gateway-origin price.
 */
export function cachedPricingCatalog(baseURL: string | undefined): PricingCatalog | null {
  const key = baseURL?.trim() || "";
  if (pricingCache && pricingCache.baseURL === key && Date.now() - pricingCache.at < PRICING_TTL_MS) {
    return pricingCache.catalog;
  }
  return null;
}

export async function loadLocalAccountUsage(
  settings: StoredSecrets,
  tenant: TenantContext,
): Promise<AccountUsagePayload> {
  const runRows = await listRunUsage(tenant);
  const fromRuns: RunUsageRecord[] = [];
  for (const row of runRows) {
    const record = asRunUsageRecord(row.usage);
    if (record) {
      fromRuns.push(record);
    }
  }
  const records = [...fromRuns, ...listDeskUsage()];
  const unknownCount = records.length;
  return {
    thisKey: settings.openaiApiKey
      ? { status: "error", message: "This-key spend updates after you generate." }
      : { status: "needs_key" },
    desk: {
      usd: 0,
      display: formatUsd(0),
      unknownCount,
      pricedCount: 0,
      byModel: [],
    },
  };
}

export async function loadAccountUsage(
  settings: StoredSecrets,
  tenant: TenantContext,
): Promise<AccountUsagePayload> {
  // With a key both gateway calls are needed; start pricing alongside this-key so an offline desk pays
  // one timeout, not two in a row (this sits on GET /settings, which the app shell waits for).
  const pricingEarly = settings.openaiApiKey
    ? pricingFor(gatewayBaseUrlFor(settings)).then(
        (catalog) => ({ catalog, error: null as unknown }),
        (error: unknown) => ({ catalog: null, error }),
      )
    : null;
  const [thisKey, runRows] = await Promise.all([thisKeyFor(settings), listRunUsage(tenant)]);
  const fromRuns: RunUsageRecord[] = [];
  for (const row of runRows) {
    const record = asRunUsageRecord(row.usage);
    if (record) {
      fromRuns.push(record);
    }
  }
  const records = [...fromRuns, ...listDeskUsage()];

  if (!settings.openaiApiKey && records.length === 0) {
    return {
      thisKey,
      desk: {
        usd: 0,
        display: formatUsd(0),
        unknownCount: 0,
        pricedCount: 0,
        byModel: [],
      },
    };
  }

  try {
    const early = pricingEarly ? await pricingEarly : null;
    if (early?.error) {
      throw early.error;
    }
    const catalog = early?.catalog ?? (await pricingFor(gatewayBaseUrlFor(settings)));
    const desk = estimateDeskUsd(records, catalog);
    return {
      thisKey,
      desk: {
        usd: desk.usd,
        display: formatUsd(desk.usd),
        unknownCount: desk.unknownCount,
        pricedCount: desk.pricedCount,
        byModel: serializeByModel(estimateDeskByModel(records, catalog)),
      },
    };
  } catch (error) {
    return {
      thisKey,
      desk: {
        usd: 0,
        display: formatUsd(0),
        unknownCount: 0,
        pricedCount: 0,
        byModel: [],
        error: error instanceof Error ? error.message : "Could not load gateway prices",
      },
    };
  }
}

function emptyBuckets(range: UsageRange, now: Date): UsageBucket[] {
  return listUsageBucketFrames(range, now).map((frame) => ({
    key: frame.key,
    label: frame.label,
    usd: 0,
    models: [],
  }));
}

function timedDeskInRange(range: UsageRange, now: Date): TimestampedRunUsage[] {
  const keySet = new Set(listUsageBucketFrames(range, now).map((frame) => frame.key));
  const timed: TimestampedRunUsage[] = [];
  for (const row of listTimedDeskUsage()) {
    if (!keySet.has(usageBucketKey(row.startedAt, range))) {
      continue;
    }
    timed.push(row);
  }
  return timed;
}

function timedRunsInRange(
  rows: Array<{ usage: unknown; startedAt: Date | null }>,
  range: UsageRange,
  now: Date,
): TimestampedRunUsage[] {
  const keySet = new Set(listUsageBucketFrames(range, now).map((frame) => frame.key));
  const timed: TimestampedRunUsage[] = [];
  for (const row of rows) {
    if (!row.startedAt) {
      continue;
    }
    const record = asRunUsageRecord(row.usage);
    if (!record) {
      continue;
    }
    const startedAt = row.startedAt instanceof Date ? row.startedAt : new Date(row.startedAt);
    if (Number.isNaN(startedAt.getTime())) {
      continue;
    }
    if (!keySet.has(usageBucketKey(startedAt, range))) {
      continue;
    }
    timed.push({ ...record, startedAt });
  }
  return timed;
}

/** Timestamped SQLite runs plus desk-usage.json rows that stored `at`. */
export async function loadRangeUsage(
  settings: StoredSecrets,
  tenant: TenantContext,
  range: UsageRange,
  now = new Date(),
): Promise<RangeUsagePayload> {
  const [thisKey, runRows] = await Promise.all([thisKeyFor(settings), listRunUsage(tenant)]);
  const timed = [...timedRunsInRange(runRows, range, now), ...timedDeskInRange(range, now)];

  if (!settings.openaiApiKey && timed.length === 0) {
    return {
      range,
      thisKey,
      desk: {
        usd: 0,
        display: formatUsd(0),
        unknownCount: 0,
        pricedCount: 0,
        modelCount: 0,
        byModel: [],
      },
      buckets: emptyBuckets(range, now),
    };
  }

  let catalog: PricingCatalog | null = null;
  let pricingError: string | undefined;
  try {
    catalog = await pricingFor(gatewayBaseUrlFor(settings));
  } catch (error) {
    pricingError = redactSecrets(error instanceof Error ? error.message : "Could not load gateway prices");
  }

  const desk = summarizeUsageDesk(timed, catalog);
  return {
    range,
    thisKey,
    desk: {
      usd: desk.usd,
      display: formatUsd(desk.usd),
      unknownCount: desk.unknownCount,
      pricedCount: desk.pricedCount,
      modelCount: desk.modelCount,
      byModel: serializeByModel(desk.byModel),
      ...(pricingError ? { error: pricingError } : {}),
    },
    buckets: buildUsageBuckets(timed, range, catalog, now),
  };
}
