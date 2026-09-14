export type PresentationLocale = "en" | "id";

function readLocale(value: unknown): PresentationLocale | undefined {
  if (value === "id" || value === "en") {
    return value;
  }
  if (value && typeof value === "object" && "locale" in value) {
    const locale = (value as { locale?: unknown }).locale;
    if (locale === "id" || locale === "en") {
      return locale;
    }
  }
  return undefined;
}

/** Resolve locale from settings, env, or request body. Default en. */
export function presentationLocale(input: { settings?: unknown; body?: unknown } = {}): PresentationLocale {
  return readLocale(input.settings) ?? readLocale(process.env.AGENTFORGE_LOCALE) ?? readLocale(input.body) ?? "en";
}

let bootLocale: PresentationLocale | null = null;

/** Process-boot freeze so a Settings save does not mix languages mid-session. */
export function presentationBootLocale(settings?: unknown): PresentationLocale {
  if (!bootLocale) {
    bootLocale = presentationLocale({ settings });
  }
  return bootLocale;
}

/** Test seam. */
export function resetPresentationBootLocaleForTests(): void {
  bootLocale = null;
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
