import * as core from "@agentforge/core";
import en from "../../../apps/web/locales/en/finance.json";
import id from "../../../apps/web/locales/id/finance.json";
import { loadSettings } from "./settings-store";

export type AppLocale = "en" | "id";
export type FinanceCopy = typeof en;

const catalogs: Record<AppLocale, FinanceCopy> = { en, id };

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (vars[key] === undefined ? `{${key}}` : String(vars[key])));
}

/**
 * Boot locale from i18n core: getLocale() when exported, else AGENTFORGE_LOCALE freeze,
 * else owner settings.locale. Default en.
 */
export function financeBootLocale(settings?: { locale?: unknown } | null): AppLocale {
  const helper = (core as { getLocale?: () => unknown }).getLocale;
  if (typeof helper === "function") {
    const value = helper();
    if (value === "id" || value === "en") {
      return value;
    }
  }
  const frozen = process.env.AGENTFORGE_LOCALE;
  if (frozen === "id" || frozen === "en") {
    return frozen;
  }
  const stored = settings?.locale ?? (loadSettings() as { locale?: unknown }).locale;
  return stored === "id" ? "id" : "en";
}

export function financeCopy(locale: AppLocale = financeBootLocale()): FinanceCopy {
  return catalogs[locale] ?? catalogs.en;
}

export function financeFill(template: string, vars: Record<string, string | number>): string {
  return fill(template, vars);
}

export function financeIntlLocale(locale: AppLocale): string {
  return locale === "id" ? "id-ID" : "en-US";
}

const METRIC_LABELS: Array<[string, keyof FinanceCopy["metrics"]]> = [
  ["Revenue growth", "revenueGrowth"],
  ["Operating expenses", "opex"],
  ["Gross profit", "grossProfit"],
  ["Gross margin", "grossMargin"],
  ["Net profit", "netProfit"],
  ["Net margin", "netMargin"],
  ["Cash on hand", "cash"],
  ["Net burn per period", "burn"],
  ["Current ratio", "currentRatio"],
  ["Debt to equity", "debtToEquity"],
  ["Breakeven units", "breakevenUnits"],
  ["Breakeven revenue", "breakevenRevenue"],
  ["Net present value", "npv"],
  ["Internal rate of return", "irr"],
  ["Revenue", "revenue"],
  ["Runway", "runway"],
];

export function localizeMetricLabel(label: string, locale: AppLocale): string {
  const metrics = financeCopy(locale).metrics;
  for (const [english, key] of METRIC_LABELS) {
    if (label === english || label.startsWith(`${english} `)) {
      return `${metrics[key]}${label.slice(english.length)}`;
    }
  }
  return label;
}

/** Test hook: pin AGENTFORGE_LOCALE the way i18n core freezes boot locale. */
export function setFinanceBootLocaleForTests(locale: AppLocale): void {
  process.env.AGENTFORGE_LOCALE = locale;
}

export function resetFinanceBootLocaleForTests(previous?: string): void {
  if (previous === undefined) {
    delete process.env.AGENTFORGE_LOCALE;
  } else {
    process.env.AGENTFORGE_LOCALE = previous;
  }
}
