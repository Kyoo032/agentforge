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
  type UsageRange,
} from "@agentforge/core";
import type { TenantContext } from "@agentforge/core";
import { listDeskUsage } from "./desk-usage";
import { listRunUsage } from "./threads";

const PRICING_TTL_MS = 10 * 60 * 1000;

let pricingCache: { at: number; baseURL: string; catalog: PricingCatalog } | null = null;

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

async function pricingFor(baseURL: string | undefined): Promise<PricingCatalog> {
  const key = baseURL?.trim() || "";
  if (pricingCache && pricingCache.baseURL === key && Date.now() - pricingCache.at < PRICING_TTL_MS) {
    return pricingCache.catalog;
  }
  const catalog = await fetchPricingCatalog({ baseURL });
  pricingCache = { at: Date.now(), baseURL: key, catalog };
  return catalog;
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
  const thisKey = await loadThisKeyState({
    baseURL: settings.openaiBaseUrl,
    apiKey: settings.openaiApiKey,
  });

  const runRows = await listRunUsage(tenant);
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
    const catalog = await pricingFor(settings.openaiBaseUrl);
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

/** Timestamped SQLite runs only — no desk-usage.json. */
export async function loadRangeUsage(
  settings: StoredSecrets,
  tenant: TenantContext,
  range: UsageRange,
  now = new Date(),
): Promise<RangeUsagePayload> {
  const thisKey = await loadThisKeyState({
    baseURL: settings.openaiBaseUrl,
    apiKey: settings.openaiApiKey,
  });

  const runRows = await listRunUsage(tenant);
  const timed = timedRunsInRange(runRows, range, now);

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
    catalog = await pricingFor(settings.openaiBaseUrl);
  } catch (error) {
    pricingError = error instanceof Error ? error.message : "Could not load gateway prices";
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
