import { DEFAULT_APP_LOCALE, parseAppLocale, type AppLocale } from "@agentforge/core/locale";
import enAuth from "../locales/en/auth.json";
import enChannels from "../locales/en/channels.json";
import enChat from "../locales/en/chat.json";
import enCommon from "../locales/en/common.json";
import enData from "../locales/en/data.json";
import enDocuments from "../locales/en/documents.json";
import enEdit from "../locales/en/edit.json";
import enFinance from "../locales/en/finance.json";
import enImages from "../locales/en/images.json";
import enKnowledge from "../locales/en/knowledge.json";
import enLegal from "../locales/en/legal.json";
import enMarket from "../locales/en/market.json";
import enMeeting from "../locales/en/meeting.json";
import enMusic from "../locales/en/music.json";
import enOnboarding from "../locales/en/onboarding.json";
import enPlans from "../locales/en/plans.json";
import enPresentation from "../locales/en/presentation.json";
import enRail from "../locales/en/rail.json";
import enResearch from "../locales/en/research.json";
import enSettings from "../locales/en/settings.json";
import enUsage from "../locales/en/usage.json";
import enVideos from "../locales/en/videos.json";
import enWorkspaces from "../locales/en/workspaces.json";
import idAuth from "../locales/id/auth.json";
import idChannels from "../locales/id/channels.json";
import idChat from "../locales/id/chat.json";
import idCommon from "../locales/id/common.json";
import idData from "../locales/id/data.json";
import idDocuments from "../locales/id/documents.json";
import idEdit from "../locales/id/edit.json";
import idFinance from "../locales/id/finance.json";
import idImages from "../locales/id/images.json";
import idKnowledge from "../locales/id/knowledge.json";
import idLegal from "../locales/id/legal.json";
import idMarket from "../locales/id/market.json";
import idMeeting from "../locales/id/meeting.json";
import idMusic from "../locales/id/music.json";
import idOnboarding from "../locales/id/onboarding.json";
import idPlans from "../locales/id/plans.json";
import idPresentation from "../locales/id/presentation.json";
import idRail from "../locales/id/rail.json";
import idResearch from "../locales/id/research.json";
import idSettings from "../locales/id/settings.json";
import idUsage from "../locales/id/usage.json";
import idVideos from "../locales/id/videos.json";
import idWorkspaces from "../locales/id/workspaces.json";

const NAMESPACES = [
  "common",
  "rail",
  "settings",
  "onboarding",
  "chat",
  "documents",
  "research",
  "images",
  "videos",
  "music",
  "presentation",
  "plans",
  "knowledge",
  "workspaces",
  "usage",
  "channels",
  "market",
  "data",
  "finance",
  "legal",
  "edit",
  "meeting",
  "auth",
] as const;
type Namespace = (typeof NAMESPACES)[number];
type MessageTree = { [key: string]: string | MessageTree };

const catalogs: Record<AppLocale, Record<Namespace, MessageTree>> = {
  en: {
    common: enCommon,
    rail: enRail,
    settings: enSettings,
    onboarding: enOnboarding,
    chat: enChat,
    documents: enDocuments,
    research: enResearch,
    images: enImages,
    videos: enVideos,
    music: enMusic,
    presentation: enPresentation,
    plans: enPlans,
    knowledge: enKnowledge,
    channels: enChannels,
    workspaces: enWorkspaces,
    usage: enUsage,
    market: enMarket,
    data: enData,
    finance: enFinance,
    legal: enLegal,
    edit: enEdit,
    meeting: enMeeting,
    auth: enAuth,
  },
  id: {
    common: idCommon,
    rail: idRail,
    settings: idSettings,
    onboarding: idOnboarding,
    chat: idChat,
    documents: idDocuments,
    research: idResearch,
    images: idImages,
    videos: idVideos,
    music: idMusic,
    presentation: idPresentation,
    plans: idPlans,
    knowledge: idKnowledge,
    channels: idChannels,
    workspaces: idWorkspaces,
    usage: idUsage,
    market: idMarket,
    data: idData,
    finance: idFinance,
    legal: idLegal,
    edit: idEdit,
    meeting: idMeeting,
    auth: idAuth,
  },
};

let frozen: AppLocale | null = null;

export const LOCALE_RESTART_EVENT = "agentforge-locale-restart";

export function freezeLocale(locale: unknown): AppLocale {
  if (frozen) {
    return frozen;
  }
  return applyLocale(locale);
}

/** Overwrite the boot freeze. Settings Restart is the only product caller. */
export function applyLocale(locale: unknown): AppLocale {
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

function walk(node: unknown, parts: string[]): unknown {
  let current = node;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
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
  const catalog = catalogs[locale][ns as Namespace];
  const nested = walk(catalog, rest.split("."));
  if (typeof nested === "string") {
    return nested;
  }
  const flat = catalog[rest];
  return typeof flat === "string" ? flat : undefined;
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
