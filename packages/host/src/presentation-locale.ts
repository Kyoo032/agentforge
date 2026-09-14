export type PresentationLocale = "en" | "id";

/** Boot locale from i18n core (AGENTFORGE_LOCALE freeze or owner settings.locale). Default en. */
export function presentationLocale(settings?: { locale?: unknown } | null): PresentationLocale {
  const frozen = process.env.AGENTFORGE_LOCALE;
  if (frozen === "id" || frozen === "en") {
    return frozen;
  }
  return settings?.locale === "id" ? "id" : "en";
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
