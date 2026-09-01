import {
  asRunUsageRecord,
  estimateDeskUsd,
  fetchPricingCatalog,
  formatUsd,
  loadThisKeyState,
  type PricingCatalog,
  type RunUsageRecord,
  type StoredSecrets,
  type ThisKeyState,
} from "@agentforge/core";
import type { TenantContext } from "@agentforge/core";
import { listDeskUsage } from "./desk-usage";
import { listRunUsage } from "./threads";

const PRICING_TTL_MS = 10 * 60 * 1000;

let pricingCache: { at: number; baseURL: string; catalog: PricingCatalog } | null = null;

export type AccountUsagePayload = {
  thisKey: ThisKeyState;
  desk: {
    usd: number;
    display: string;
    unknownCount: number;
    pricedCount: number;
    error?: string;
  };
};

async function pricingFor(baseURL: string | undefined): Promise<PricingCatalog> {
  const key = baseURL?.trim() || "";
  if (pricingCache && pricingCache.baseURL === key && Date.now() - pricingCache.at < PRICING_TTL_MS) {
    return pricingCache.catalog;
  }
  const catalog = await fetchPricingCatalog({ baseURL });
  pricingCache = { at: Date.now(), baseURL: key, catalog };
  return catalog;
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
        error: error instanceof Error ? error.message : "Could not load Toko Token prices",
      },
    };
  }
}
