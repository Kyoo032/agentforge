import { DEFAULT_APP_LOCALE, parseAppLocale, type AppLocale } from "@agentforge/core";
import enCommon from "../locales/en/common.json";
import enOnboarding from "../locales/en/onboarding.json";
import enRail from "../locales/en/rail.json";
import enSettings from "../locales/en/settings.json";
import idCommon from "../locales/id/common.json";
import idOnboarding from "../locales/id/onboarding.json";
import idRail from "../locales/id/rail.json";
import idSettings from "../locales/id/settings.json";

const NAMESPACES = ["common", "rail", "settings", "onboarding"] as const;
type Namespace = (typeof NAMESPACES)[number];
type Catalog = Record<Namespace, Record<string, string>>;

const catalogs: Record<AppLocale, Catalog> = {
  en: { common: enCommon, rail: enRail, settings: enSettings, onboarding: enOnboarding },
  id: { common: idCommon, rail: idRail, settings: idSettings, onboarding: idOnboarding },
};

let frozen: AppLocale | null = null;

export function freezeLocale(locale: unknown): AppLocale {
  if (frozen) {
    return frozen;
  }
  frozen = parseAppLocale(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = frozen;
  }
  return frozen;
}

export function getLocale(): AppLocale {
  return frozen ?? DEFAULT_APP_LOCALE;
}

export function resetLocaleForTests(): void {
  frozen = null;
}

function lookup(locale: AppLocale, key: string): string | undefined {
  const dot = key.indexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  const ns = key.slice(0, dot);
  const rest = key.slice(dot + 1);
  if (!NAMESPACES.includes(ns as Namespace)) {
    return undefined;
  }
  const value = catalogs[locale][ns as Namespace][rest];
  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (all, name: string) => {
    const value = vars[name];
    return value == null ? all : String(value);
  });
}

/** Single UI translator. Missing `id` keys fall back to English; missing English returns the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const locale = getLocale();
  const value = lookup(locale, key) ?? (locale === "en" ? undefined : lookup("en", key));
  if (value == null) {
    return key;
  }
  return interpolate(value, vars);
}
