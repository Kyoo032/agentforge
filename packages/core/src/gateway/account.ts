import { GATEWAY_BASE_URL, DEFAULT_GROUP_RATIO, gatewayOriginFromBaseUrl, quotaToUsd } from "../gateway";
import { redactSecrets } from "../security/redact";
import { assertAllowedEndpointUrl } from "../security/tls";

const FETCH_MS = 8_000;

export type RunUsageRecord = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  unknown?: boolean;
};

export type PricingModel = {
  modelName: string;
  quotaType: number;
  modelRatio: number;
  completionRatio: number;
  modelPrice: number;
  billingMode?: string;
};

export type PricingCatalog = {
  models: PricingModel[];
  groupRatio: Record<string, number>;
};

export type ThisKeyUsage = {
  name?: string;
  usedUsd: number;
  remainingUsd: number | null;
  unlimited: boolean;
  expiresAt: number;
};

export type ThisKeyState =
  | { status: "needs_key" }
  | { status: "ok"; data: ThisKeyUsage }
  | { status: "error"; message: string };

export type DeskEstimate = {
  usd: number;
  unknownCount: number;
  pricedCount: number;
};

export type DeskModelSpend = {
  model: string;
  usd: number;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  unknown: boolean;
};

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function readLanguageModelUsage(raw: unknown): { inputTokens: number; outputTokens: number } {
  const record = asRecord(raw);
  if (!record) {
    return { inputTokens: 0, outputTokens: 0 };
  }
  return {
    inputTokens: asNumber(record.inputTokens) ?? asNumber(record.promptTokens) ?? asNumber(record.prompt_tokens) ?? 0,
    outputTokens:
      asNumber(record.outputTokens) ?? asNumber(record.completionTokens) ?? asNumber(record.completion_tokens) ?? 0,
  };
}

export function asRunUsageRecord(raw: unknown): RunUsageRecord | null {
  const record = asRecord(raw);
  if (!record || typeof record.model !== "string" || record.model.trim().length === 0) {
    return null;
  }
  const inputTokens = asNumber(record.inputTokens) ?? 0;
  const outputTokens = asNumber(record.outputTokens) ?? 0;
  const unknown = record.unknown === true;
  if (!unknown && inputTokens <= 0 && outputTokens <= 0) {
    return null;
  }
  return {
    model: record.model.trim(),
    inputTokens: Math.max(0, inputTokens),
    outputTokens: Math.max(0, outputTokens),
    ...(unknown ? { unknown: true } : {}),
  };
}

export function addTokenUsage(
  left: { inputTokens: number; outputTokens: number },
  right: { inputTokens: number; outputTokens: number },
): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  };
}

function lookupModel(catalog: PricingCatalog, model: string): PricingModel | undefined {
  const needle = model.trim().toLowerCase();
  return catalog.models.find((item) => item.modelName.toLowerCase() === needle);
}

export function isUnpricedBilling(model: PricingModel): boolean {
  return model.billingMode === "tiered_expr" || (model.quotaType === 1 && model.modelPrice <= 0 && model.modelRatio <= 0);
}

/** Estimate USD for one run. `null` means do not invent a number (tiered / missing catalog). */
export function estimateRunUsd(
  usage: RunUsageRecord,
  catalog: PricingCatalog,
  groupRatio = DEFAULT_GROUP_RATIO,
): number | null {
  if (usage.unknown) {
    return null;
  }
  const model = lookupModel(catalog, usage.model);
  if (!model) {
    return null;
  }
  if (isUnpricedBilling(model)) {
    return null;
  }
  const group = Number.isFinite(groupRatio) && groupRatio > 0 ? groupRatio : DEFAULT_GROUP_RATIO;
  if (model.quotaType === 1) {
    return model.modelPrice * group;
  }
  const completion = model.completionRatio > 0 ? model.completionRatio : 1;
  const ratio = model.modelRatio > 0 ? model.modelRatio : 1;
  const quota = (usage.inputTokens + usage.outputTokens * completion) * ratio * group;
  return quotaToUsd(quota);
}

export function estimateDeskUsd(
  records: RunUsageRecord[],
  catalog: PricingCatalog,
  groupRatio = DEFAULT_GROUP_RATIO,
): DeskEstimate {
  let usd = 0;
  let unknownCount = 0;
  let pricedCount = 0;
  for (const record of records) {
    const value = estimateRunUsd(record, catalog, groupRatio);
    if (value == null) {
      unknownCount += 1;
      continue;
    }
    usd += value;
    pricedCount += 1;
  }
  return { usd, unknownCount, pricedCount };
}

/** Group desk runs by model id and price each group the same way as `estimateDeskUsd`. */
export function estimateDeskByModel(
  records: RunUsageRecord[],
  catalog: PricingCatalog,
  groupRatio = DEFAULT_GROUP_RATIO,
): DeskModelSpend[] {
  const groups = new Map<string, DeskModelSpend>();
  for (const record of records) {
    const existing = groups.get(record.model) ?? {
      model: record.model,
      usd: 0,
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      unknown: false,
    };
    existing.runCount += 1;
    existing.inputTokens += record.inputTokens;
    existing.outputTokens += record.outputTokens;
    const value = estimateRunUsd(record, catalog, groupRatio);
    if (value == null) {
      existing.unknown = true;
    } else {
      existing.usd += value;
    }
    groups.set(record.model, existing);
  }
  return [...groups.values()].sort((left, right) => {
    if (right.usd !== left.usd) {
      return right.usd - left.usd;
    }
    if (right.runCount !== left.runCount) {
      return right.runCount - left.runCount;
    }
    return left.model.localeCompare(right.model);
  });
}

export function parsePricingCatalog(body: unknown): PricingCatalog {
  const root = asRecord(body);
  const data = Array.isArray(root?.data) ? root.data : Array.isArray(body) ? body : [];
  const models: PricingModel[] = [];
  for (const item of data) {
    const record = asRecord(item);
    if (!record || typeof record.model_name !== "string" || record.model_name.trim().length === 0) {
      continue;
    }
    const billingMode = typeof record.billing_mode === "string" ? record.billing_mode : undefined;
    models.push({
      modelName: record.model_name.trim(),
      quotaType: asNumber(record.quota_type) ?? 0,
      modelRatio: asNumber(record.model_ratio) ?? 1,
      completionRatio: asNumber(record.completion_ratio) ?? 1,
      modelPrice: asNumber(record.model_price) ?? 0,
      ...(billingMode ? { billingMode } : {}),
    });
  }
  const groupRatio: Record<string, number> = {};
  const groups = asRecord(root?.group_ratio);
  if (groups) {
    for (const [key, value] of Object.entries(groups)) {
      const ratio = asNumber(value);
      if (ratio != null) {
        groupRatio[key] = ratio;
      }
    }
  }
  return { models, groupRatio };
}

export function parseTokenUsage(body: unknown): ThisKeyUsage | null {
  const root = asRecord(body);
  const nested = asRecord(root?.data);
  const data = nested ?? root;
  if (!data) {
    return null;
  }
  const used = asNumber(data.total_used);
  const available = asNumber(data.total_available);
  const granted = asNumber(data.total_granted);
  const unlimited = data.unlimited_quota === true;
  if (used == null && available == null && granted == null) {
    return null;
  }
  const usedQuota = used ?? Math.max(0, (granted ?? 0) - (available ?? 0));
  const remainingQuota = unlimited ? null : (available ?? Math.max(0, (granted ?? 0) - usedQuota));
  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : undefined;
  const expiresAt = asNumber(data.expires_at) ?? 0;
  return {
    name,
    usedUsd: quotaToUsd(usedQuota),
    remainingUsd: remainingQuota == null ? null : quotaToUsd(remainingQuota),
    unlimited,
    expiresAt,
  };
}

function parseBillingFallback(subscription: unknown, usage: unknown): ThisKeyUsage | null {
  const sub = asRecord(subscription);
  const use = asRecord(usage);
  const hard = asNumber(sub?.hard_limit_usd);
  const totalUsage = asNumber(use?.total_usage);
  if (hard == null && totalUsage == null) {
    return null;
  }
  let usedUsd = 0;
  if (totalUsage != null) {
    usedUsd = totalUsage > 1000 ? quotaToUsd(totalUsage) : totalUsage > 50 ? totalUsage / 100 : totalUsage;
  }
  const remainingUsd = hard == null ? null : Math.max(0, hard - usedUsd);
  return {
    usedUsd,
    remainingUsd,
    unlimited: hard == null || hard <= 0,
    expiresAt: 0,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Endpoint did not return JSON");
  }
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  assertAllowedEndpointUrl(url);
  const response = await fetchFn(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_MS),
  });
  const body = await readJson(response).catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

export async function fetchPricingCatalog(input: {
  baseURL?: string;
  fetch?: typeof fetch;
}): Promise<PricingCatalog> {
  const origin = gatewayOriginFromBaseUrl(input.baseURL ?? GATEWAY_BASE_URL);
  const result = await getJson(`${origin}/api/pricing`, { Accept: "application/json" }, input.fetch ?? fetch);
  if (!result.ok) {
    throw new Error(`Could not load Toko Token prices (${result.status})`);
  }
  const catalog = parsePricingCatalog(result.body);
  if (catalog.models.length === 0) {
    throw new Error("Toko Token price list was empty");
  }
  return catalog;
}

export async function fetchThisKeyUsage(input: {
  baseURL?: string;
  apiKey: string;
  fetch?: typeof fetch;
}): Promise<ThisKeyUsage> {
  const origin = gatewayOriginFromBaseUrl(input.baseURL ?? GATEWAY_BASE_URL);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${input.apiKey}`,
  };
  const fetchFn = input.fetch ?? fetch;
  const primary = await getJson(`${origin}/api/usage/token`, headers, fetchFn);
  if (primary.ok) {
    const parsed = parseTokenUsage(primary.body);
    if (parsed) {
      return parsed;
    }
  }
  if (primary.status === 401 || primary.status === 403) {
    throw new Error("This key could not read usage. Open the Toko Token dashboard for billed spend.");
  }
  if (primary.status === 404 || !primary.ok) {
    const subscription = await getJson(`${origin}/v1/dashboard/billing/subscription`, headers, fetchFn);
    const usage = await getJson(`${origin}/v1/dashboard/billing/usage`, headers, fetchFn);
    const fallback = parseBillingFallback(subscription.body, usage.body);
    if (fallback && (subscription.ok || usage.ok)) {
      return fallback;
    }
  }
  const detail =
    typeof asRecord(primary.body)?.message === "string"
      ? String(asRecord(primary.body)?.message)
      : `Could not read this key’s usage (${primary.status})`;
  throw new Error(redactSecrets(detail));
}

export async function loadThisKeyState(input: {
  baseURL?: string;
  apiKey?: string;
  fetch?: typeof fetch;
}): Promise<ThisKeyState> {
  if (!input.apiKey || input.apiKey.trim().length === 0) {
    return { status: "needs_key" };
  }
  try {
    const data = await fetchThisKeyUsage({
      baseURL: input.baseURL,
      apiKey: input.apiKey,
      fetch: input.fetch,
    });
    return { status: "ok", data };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : "Could not read this key’s usage");
    return { status: "error", message };
  }
}
