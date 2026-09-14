import type { AppLocale } from "@agentforge/core";
import { localeForRun } from "./run-context";

export type PresentationLocale = AppLocale;

/** Slide-copy language follows i18n core (`localeForRun` → boot locale). */
export function presentationLocale(): PresentationLocale {
  return localeForRun();
}

export function presentationLanguageRule(locale: PresentationLocale): string {
  if (locale === "id") {
    return "Write every user-facing string (title, heading, subhead, bullets, aside, notes) in professional Bahasa Indonesia (polite Anda / infinitive). Keep brand names DPSBuddy, Toko Token, and TokenKu unchanged. Do not mix English except those brands and proper nouns.";
  }
  return "Write every user-facing string (title, heading, subhead, bullets, aside, notes) in English.";
}

export function presentationKicker(locale: PresentationLocale): string {
  return locale === "id" ? "PRESENTASI" : "PRESENTATION";
}

export function presentationGatewayMessage(locale: PresentationLocale): string {
  if (locale === "id") {
    return "Pembuatan presentasi membutuhkan gateway yang aktif. Tempel kunci API Toko Token di Pengaturan, lalu coba lagi.";
  }
  return "Presentation generation needs a live gateway. Paste a Toko Token API key in Settings, then try again.";
}
