export type VideoStudioLocale = "en" | "id";

/** Keep in sync with `apps/web/locales/{en,id}/videos.json`. */
const GENERATE_ERROR: Record<VideoStudioLocale, string> = {
  en: "Video generation failed",
  id: "Pembuatan video gagal",
};

const NEEDS_KEY: Record<VideoStudioLocale, string> = {
  en: "Add a Toko Token gateway key in Settings to generate videos.",
  id: "Tambahkan kunci gateway Toko Token di Pengaturan untuk membuat video.",
};

const STILL_UNSUPPORTED: Record<VideoStudioLocale, string> = {
  en: "This model does not accept a still image",
  id: "Model ini tidak menerima gambar diam",
};

/** Keep in sync with `apps/web/locales/{en,id}/videos.json` `outputTextLanguage`. */
const OUTPUT_TEXT_LANGUAGE: Record<VideoStudioLocale, string> = {
  en: "Spoken dialogue, narration, and any on-screen text in this clip must be in English unless the prompt already names another language.",
  id: "Dialog, narasi, dan teks di layar pada klip ini harus dalam bahasa Indonesia, kecuali prompt sudah menyebut bahasa lain.",
};

/** Boot locale frozen by i18n core (process env or owner settings). Default en. */
export function videoStudioLocale(settings: { locale?: unknown } | null | undefined): VideoStudioLocale {
  const frozen = process.env.AGENTFORGE_LOCALE;
  if (frozen === "id" || frozen === "en") {
    return frozen;
  }
  return settings?.locale === "id" ? "id" : "en";
}

export function videoOutputLanguageHint(locale: VideoStudioLocale): string {
  return OUTPUT_TEXT_LANGUAGE[locale];
}

export function videoGenerateFailedMessage(locale: VideoStudioLocale): string {
  return GENERATE_ERROR[locale];
}

export function videoNeedsKeyMessage(locale: VideoStudioLocale): string {
  return NEEDS_KEY[locale];
}

export function videoStillUnsupportedMessage(locale: VideoStudioLocale): string {
  return STILL_UNSUPPORTED[locale];
}

/** Instruct the video model to speak and letter in the boot locale. Does not rewrite the stored prompt. */
export function withVideoOutputLanguage(prompt: string, locale: VideoStudioLocale): string {
  const hint = videoOutputLanguageHint(locale);
  if (prompt.includes(hint)) {
    return prompt;
  }
  return `${prompt}\n\n${hint}`;
}
