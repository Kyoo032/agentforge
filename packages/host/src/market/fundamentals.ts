/**
 * Yahoo `quoteSummary` adapter for the analyst team: company fundamentals
 * (valuation, margins, balance sheet) and a 90-day insider buy/sell tally.
 *
 * Same posture as the other adapters: one vendor call behind an injectable
 * client so tests run on fixtures, a hard timeout merged with the caller's
 * signal, every kept field validated by zod, and the only two free-text fields
 * (sector, industry) through `sanitizeExternalText` + `maskPii` before they can
 * reach a prompt.
 *
 * The insider window is computed here, not asked of Yahoo: the vendor returns a
 * rolling list of filings and we keep the ones dated within
 * `INSIDER_WINDOW_DAYS` of the observation time. `.JK` names usually carry no
 * `insiderTransactions` at all, which is a missing section, not a failure — the
 * fundamentals still come back and `insiders` is simply absent.
 */
import { maskPii } from "@agentforge/core";
import {
  INSIDER_WINDOW,
  INSIDER_WINDOW_DAYS,
  tickerFundamentalsSchema,
  tickerInsidersSchema,
  type TickerFundamentals,
  type TickerInsiders,
} from "@agentforge/core/market";
import { errorMessage, withTimeout } from "./abort";
import { sanitizeExternalText } from "./sanitize";
import type { YahooFetchOptions } from "./yahoo";
import { createYahooClient } from "./yahoo";

/** The `quoteSummary` modules this adapter asks for. Anything outside them is never read. */
export const FUNDAMENTALS_MODULES = [
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "assetProfile",
  "insiderTransactions",
] as const;

/** Filings read per symbol before the rest are ignored; Yahoo returns a long rolling list. */
export const INSIDER_ROWS_MAX = 200;
/** `sector` / `industry` are short labels, not prose. */
export const PROFILE_LABEL_MAX = 80;

const ADAPTER = "yahoo.quoteSummary";
const YAHOO = "yahoo" as const;

/**
 * The cache holds exactly what the packet carries, so core owns both shapes and
 * this module only fills them. Re-exported under the host's own names because
 * `repo.ts` keys its payload map by cache kind, not by packet field.
 */
export const fundamentalsSchema = tickerFundamentalsSchema;
export const insidersSchema = tickerInsidersSchema;
export type Fundamentals = TickerFundamentals;
export type Insiders = TickerInsiders;
export { INSIDER_WINDOW, INSIDER_WINDOW_DAYS };

export type FundamentalsResult = {
  fundamentals?: Fundamentals;
  insiders?: Insiders;
  /** "fundamentals: <reason>" when the vendor call failed; null on success, even an empty one. */
  failure: string | null;
};

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

/** Validated results give plain numbers, raw ones give `{ raw, fmt }`; anything else is absent. */
function num(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const cell = rec(value);
  return cell && typeof cell.raw === "number" && Number.isFinite(cell.raw) ? cell.raw : undefined;
}

/** A Yahoo ratio (0.345) as a percentage (34.5). Absent stays absent; nothing is defaulted to zero. */
function pct(value: unknown): number | undefined {
  const raw = num(value);
  return raw === undefined ? undefined : raw * 100;
}

/** A vendor label, HTML-stripped, injection-scanned, PII-masked and capped. Suspect text is dropped outright. */
export function profileLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const clean = sanitizeExternalText(value);
  if (!clean.text || clean.injectionSuspect) {
    return undefined;
  }
  const masked = maskPii(clean.text).slice(0, PROFILE_LABEL_MAX).trim();
  return masked || undefined;
}

function toMillis(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  const cell = rec(value);
  return cell ? toMillis(cell.raw ?? cell.fmt) : null;
}

/** Yahoo's free-text transaction label onto a side. Grants, awards and conversions are neither. */
export function insiderSide(text: unknown): "buy" | "sell" | null {
  const label = typeof text === "string" ? text.toLowerCase() : "";
  if (!label) {
    return null;
  }
  if (/\b(?:purchase|bought|buy)\b/.test(label)) {
    return "buy";
  }
  return /\b(?:sale|sold|sell)\b/.test(label) ? "sell" : null;
}

/**
 * Every kept figure from the five modules. `undefined` everywhere the vendor
 * had nothing — a missing margin is missing, never zero. Returns undefined when
 * the payload carried no usable field at all, so the caller can treat it as
 * "no data" rather than storing an empty row.
 */
export function parseFundamentals(payload: unknown, observedAt: string): Fundamentals | undefined {
  const root = rec(payload) ?? {};
  const summary = rec(root.summaryDetail) ?? {};
  const stats = rec(root.defaultKeyStatistics) ?? {};
  const financial = rec(root.financialData) ?? {};
  const profile = rec(root.assetProfile) ?? {};
  // `trailingAnnualDividendYield` is unambiguously a ratio; `dividendYield` has shipped both ways.
  const dividendRatio = num(summary.trailingAnnualDividendYield) ?? num(summary.dividendYield);
  const draft = {
    sector: profileLabel(profile.sector),
    industry: profileLabel(profile.industry),
    marketCap: num(summary.marketCap),
    trailingPe: num(summary.trailingPE),
    forwardPe: num(summary.forwardPE) ?? num(stats.forwardPE),
    peg: num(stats.pegRatio),
    priceToBook: num(stats.priceToBook),
    epsTrailing: num(stats.trailingEps),
    epsForward: num(stats.forwardEps),
    dividendYieldPct: dividendRatio === undefined ? undefined : dividendRatio * 100,
    beta: num(summary.beta) ?? num(stats.beta),
    revenueTtm: num(financial.totalRevenue),
    grossMarginPct: pct(financial.grossMargins),
    operatingMarginPct: pct(financial.operatingMargins),
    profitMarginPct: pct(financial.profitMargins),
    roePct: pct(financial.returnOnEquity),
    roaPct: pct(financial.returnOnAssets),
    // Yahoo already reports this one as a percentage of equity, so it is kept as given.
    debtToEquity: num(financial.debtToEquity),
    currentRatio: num(financial.currentRatio),
    freeCashflow: num(financial.freeCashflow),
    source: YAHOO,
    observedAt,
  };
  const hasAny = Object.entries(draft).some(
    ([key, value]) => value !== undefined && key !== "source" && key !== "observedAt",
  );
  return hasAny ? fundamentalsSchema.parse(draft) : undefined;
}

/**
 * Buys, sells and the net share balance over the last `INSIDER_WINDOW_DAYS`,
 * counted here from the filing dates. Undefined when the vendor carried no
 * `insiderTransactions` section or nothing fell inside the window (`.JK` names,
 * mostly) — an absent tally, not a zero one.
 */
export function parseInsiders(payload: unknown, observedAt: string): Insiders | undefined {
  const rows = rec(rec(payload)?.insiderTransactions)?.transactions;
  if (!Array.isArray(rows)) {
    return undefined;
  }
  const nowMs = Date.parse(observedAt);
  if (Number.isNaN(nowMs)) {
    return undefined;
  }
  const cutoff = nowMs - INSIDER_WINDOW_DAYS * 86_400_000;
  let buys = 0;
  let sells = 0;
  let netShares = 0;
  let sawShares = false;
  for (const raw of rows.slice(0, INSIDER_ROWS_MAX)) {
    const row = rec(raw);
    const at = toMillis(row?.startDate);
    const side = insiderSide(row?.transactionText);
    if (at === null || at < cutoff || at > nowMs || !side) {
      continue;
    }
    const shares = num(row?.shares);
    if (side === "buy") {
      buys += 1;
      netShares += shares ?? 0;
    } else {
      sells += 1;
      netShares -= shares ?? 0;
    }
    sawShares = sawShares || shares !== undefined;
  }
  if (buys === 0 && sells === 0) {
    return undefined;
  }
  return insidersSchema.parse({
    window: INSIDER_WINDOW,
    buys,
    sells,
    ...(sawShares ? { netShares } : {}),
    source: YAHOO,
    observedAt,
  });
}

/**
 * One `quoteSummary` call per symbol. Network, HTTP and schema failures come
 * back as a failure string with no payload; the packet never fails over a
 * missing P/E.
 */
export async function fetchFundamentals(
  symbol: string,
  opts: YahooFetchOptions = {},
): Promise<FundamentalsResult> {
  const client = opts.client ?? createYahooClient();
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  const { signal, dispose } = withTimeout(opts.signal, opts.timeoutMs);
  try {
    const payload = await client.quoteSummary(symbol, FUNDAMENTALS_MODULES, signal);
    if (!rec(payload)) {
      throw new Error(`${ADAPTER} returned no summary for ${symbol}`);
    }
    const fundamentals = parseFundamentals(payload, observedAt);
    const insiders = parseInsiders(payload, observedAt);
    return {
      ...(fundamentals ? { fundamentals } : {}),
      ...(insiders ? { insiders } : {}),
      failure: null,
    };
  } catch (error) {
    return { failure: `fundamentals: ${errorMessage(error)}` };
  } finally {
    dispose();
  }
}
