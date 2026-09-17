import { DEFAULT_GROUP_RATIO, gatewayOriginFromBaseUrl, quotaToUsd, resolvedGatewayBaseUrl } from "../gateway";
import { isNetworkUnreachableError } from "../models/probe";
import { redactSecrets } from "../security/redact";
import { assertAllowedEndpointUrl } from "../security/tls";

/** GET /api/v1/settings awaits these; the app shell waits on that request, so keep it short offline. */
const FETCH_MS = 3_000;

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
  return (
    model.billingMode === "tiered_expr" || (model.quotaType === 1 && model.modelPrice <= 0 && model.modelRatio <= 0)
  );
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

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * NewAPI's this-key usage endpoint. The gateway's reverse proxy 301s the slashless
 * `/api/usage/token` to this trailing-slash form, so ask for it directly and no
 * redirect is involved at all.
 */
export const USAGE_TOKEN_PATH = "/api/usage/token/";

/** At most one redirect hop, and only back to the same origin, is ever followed with a key. */
const MAX_SAME_ORIGIN_REDIRECTS = 1;

/**
 * Returns the redirect target only when it stays on the origin the request already went to
 * (same scheme, host and port), so the Authorization header is never replayed to a new host.
 * Anything else — cross-origin, protocol downgrade, missing or unparseable Location — is null.
 */
function sameOriginRedirectTarget(requestUrl: string, location: string | null): string | null {
  if (!location || location.trim().length === 0) {
    return null;
  }
  try {
    const from = new URL(requestUrl);
    const target = new URL(location, requestUrl);
    return target.origin === from.origin ? target.toString() : null;
  } catch {
    return null;
  }
}

/**
 * These requests carry the gateway key, so a cross-origin 3xx is refused rather than followed:
 * it would replay the Authorization header against whatever host the response names. A
 * same-origin 3xx (a proxy's trailing-slash normalisation) is followed once. The error names the
 * status only, redacted, never the endpoint or its query.
 */
async function getJson(
  url: string,
  headers: Record<string, string>,
  fetchFn: typeof fetch,
  hopsLeft: number = MAX_SAME_ORIGIN_REDIRECTS,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  assertAllowedEndpointUrl(url);
  const response = await fetchFn(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(FETCH_MS),
  });
  if (REDIRECT_STATUSES.has(response.status)) {
    const target = hopsLeft > 0 ? sameOriginRedirectTarget(url, response.headers.get("location")) : null;
    if (target) {
      return getJson(target, headers, fetchFn, hopsLeft - 1);
    }
    throw new Error(redactSecrets(`Gateway endpoint redirected (${response.status}); not following it with a key`));
  }
  const body = await readJson(response).catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

export async function fetchPricingCatalog(input: { baseURL?: string; fetch?: typeof fetch }): Promise<PricingCatalog> {
  const origin = gatewayOriginFromBaseUrl(input.baseURL ?? resolvedGatewayBaseUrl());
  const result = await getJson(`${origin}/api/pricing`, { Accept: "application/json" }, input.fetch ?? fetch);
  if (!result.ok) {
    throw new Error(`Could not load gateway prices (${result.status})`);
  }
  const catalog = parsePricingCatalog(result.body);
  if (catalog.models.length === 0) {
    throw new Error("Gateway price list was empty");
  }
  return catalog;
}

export async function fetchThisKeyUsage(input: {
  baseURL?: string;
  apiKey: string;
  fetch?: typeof fetch;
}): Promise<ThisKeyUsage> {
  const origin = gatewayOriginFromBaseUrl(input.baseURL ?? resolvedGatewayBaseUrl());
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${input.apiKey}`,
  };
  const fetchFn = input.fetch ?? fetch;
  const primary = await getJson(`${origin}${USAGE_TOKEN_PATH}`, headers, fetchFn);
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
    const message = isNetworkUnreachableError(error)
      ? "Gateway unreachable. Local features keep working; usage updates when the connection is back."
      : redactSecrets(error instanceof Error ? error.message : "Could not read this key’s usage");
    return { status: "error", message };
  }
}

export type UsageRange = "day" | "week" | "month";

export type TimestampedRunUsage = RunUsageRecord & {
  startedAt: Date;
};

export type UsageBucketModel = {
  model: string;
  usd: number;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
};

export type UsageBucket = {
  key: string;
  label: string;
  usd: number;
  models: UsageBucketModel[];
};

export type UsageBucketFrame = {
  key: string;
  label: string;
};

export type UsageDeskByModel = {
  model: string;
  usd: number;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  unknown: boolean;
};

export type UsageDeskSummary = {
  usd: number;
  unknownCount: number;
  pricedCount: number;
  modelCount: number;
  byModel: UsageDeskByModel[];
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const MS_PER_DAY = 86_400_000;

export function parseUsageRange(value: unknown): UsageRange {
  if (value === "week" || value === "month" || value === "day") {
    return value;
  }
  return "day";
}

function startOfLocalDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

function formatYmd(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatYm(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Local Monday (ISO week start) for the calendar day of `at`. */
function mondayOfLocal(at: Date): Date {
  const day = startOfLocalDay(at);
  const dayNum = day.getDay() || 7;
  day.setDate(day.getDate() - (dayNum - 1));
  return day;
}

/** Local-calendar ISO week year + week number (Monday-based). */
function localIsoWeek(at: Date): { year: number; week: number } {
  const thursday = mondayOfLocal(at);
  thursday.setDate(thursday.getDate() + 3);
  const year = thursday.getFullYear();
  const week1Monday = mondayOfLocal(new Date(year, 0, 4));
  const week = 1 + Math.round((mondayOfLocal(at).getTime() - week1Monday.getTime()) / (7 * MS_PER_DAY));
  return { year, week };
}

function formatIsoWeekKey(at: Date): string {
  const { year, week } = localIsoWeek(at);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function dayLabel(at: Date): string {
  return `${MONTH_LABELS[at.getMonth()]} ${at.getDate()}`;
}

function weekLabel(at: Date): string {
  return `W${localIsoWeek(at).week}`;
}

function monthLabel(at: Date): string {
  return MONTH_LABELS[at.getMonth()] ?? "Jan";
}

/** Sortable bucket key for a local calendar instant. */
export function usageBucketKey(at: Date, range: UsageRange): string {
  if (range === "day") {
    return formatYmd(at);
  }
  if (range === "month") {
    return formatYm(at);
  }
  return formatIsoWeekKey(at);
}

/** Empty axis frames oldest → newest (day: 14, week: 8, month: 6). */
export function listUsageBucketFrames(range: UsageRange, now = new Date()): UsageBucketFrame[] {
  if (range === "day") {
    const today = startOfLocalDay(now);
    const frames: UsageBucketFrame[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      frames.push({ key: formatYmd(day), label: dayLabel(day) });
    }
    return frames;
  }
  if (range === "week") {
    const thisMonday = mondayOfLocal(now);
    const frames: UsageBucketFrame[] = [];
    for (let i = 7; i >= 0; i -= 1) {
      const monday = new Date(thisMonday);
      monday.setDate(monday.getDate() - i * 7);
      frames.push({ key: formatIsoWeekKey(monday), label: weekLabel(monday) });
    }
    return frames;
  }
  const frames: UsageBucketFrame[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
    frames.push({ key: formatYm(month), label: monthLabel(month) });
  }
  return frames;
}

function priceOrNull(usage: RunUsageRecord, catalog: PricingCatalog | null, groupRatio: number): number | null {
  if (!catalog) {
    return null;
  }
  return estimateRunUsd(usage, catalog, groupRatio);
}

function sortByUsdThenModel<T extends { usd: number; model: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    if (right.usd !== left.usd) {
      return right.usd - left.usd;
    }
    return left.model.localeCompare(right.model);
  });
}

/** Price timestamped runs into fixed calendar buckets (empty buckets kept at usd 0). */
export function buildUsageBuckets(
  runs: TimestampedRunUsage[],
  range: UsageRange,
  catalog: PricingCatalog | null,
  now = new Date(),
  groupRatio = DEFAULT_GROUP_RATIO,
): UsageBucket[] {
  const frames = listUsageBucketFrames(range, now);
  const keySet = new Set(frames.map((frame) => frame.key));
  const byKey = new Map<string, Map<string, UsageBucketModel>>();

  for (const run of runs) {
    const key = usageBucketKey(run.startedAt, range);
    if (!keySet.has(key)) {
      continue;
    }
    let models = byKey.get(key);
    if (!models) {
      models = new Map();
      byKey.set(key, models);
    }
    const existing = models.get(run.model) ?? {
      model: run.model,
      usd: 0,
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    existing.runCount += 1;
    existing.inputTokens += run.inputTokens;
    existing.outputTokens += run.outputTokens;
    const priced = priceOrNull(run, catalog, groupRatio);
    if (priced != null) {
      existing.usd += priced;
    }
    models.set(run.model, existing);
  }

  return frames.map((frame) => {
    const models = sortByUsdThenModel([...(byKey.get(frame.key)?.values() ?? [])]);
    const usd = models.reduce((sum, row) => sum + row.usd, 0);
    return {
      key: frame.key,
      label: frame.label,
      usd,
      models,
    };
  });
}

/** Desk totals for runs already filtered to the selected range window. */
export function summarizeUsageDesk(
  runs: TimestampedRunUsage[],
  catalog: PricingCatalog | null,
  groupRatio = DEFAULT_GROUP_RATIO,
): UsageDeskSummary {
  const groups = new Map<string, UsageDeskByModel>();
  let usd = 0;
  let unknownCount = 0;
  let pricedCount = 0;

  for (const run of runs) {
    const existing = groups.get(run.model) ?? {
      model: run.model,
      usd: 0,
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      unknown: false,
    };
    existing.runCount += 1;
    existing.inputTokens += run.inputTokens;
    existing.outputTokens += run.outputTokens;
    const priced = priceOrNull(run, catalog, groupRatio);
    if (priced == null) {
      existing.unknown = true;
      unknownCount += 1;
    } else {
      existing.usd += priced;
      usd += priced;
      pricedCount += 1;
    }
    groups.set(run.model, existing);
  }

  return {
    usd,
    unknownCount,
    pricedCount,
    modelCount: groups.size,
    byModel: sortByUsdThenModel([...groups.values()]),
  };
}
