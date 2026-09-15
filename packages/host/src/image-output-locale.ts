import { parseAppLocale, type AppLocale } from "@agentforge/core";

/** Images shares the app-wide locale; the alias keeps the mode's call sites readable. */
export type ImageStudioLocale = AppLocale;

/** Keep in sync with `apps/web/locales/{en,id}/images.json`. */
const GENERATE_ERROR: Record<ImageStudioLocale, string> = {
  en: "Image generation failed",
  id: "Pembuatan gambar gagal",
};

/** Keep in sync with `apps/web/locales/{en,id}/images.json` `outputTextLanguage`. */
const OUTPUT_TEXT_LANGUAGE: Record<ImageStudioLocale, string> = {
  en: "If this image includes any readable text (captions, labels, signs, or on-image UI), write that text in English.",
  id: "Jika gambar ini memuat teks yang dapat dibaca (keterangan, label, papan, atau UI pada gambar), tulis teks itu dalam bahasa Indonesia.",
};

export function imageOutputLanguageHint(locale: ImageStudioLocale): string {
  return OUTPUT_TEXT_LANGUAGE[parseAppLocale(locale)];
}

export function imageGenerateFailedMessage(locale: ImageStudioLocale): string {
  return GENERATE_ERROR[parseAppLocale(locale)];
}

/** Instruct the image model to render on-image text in the run locale. Does not rewrite the stored prompt. */
export function withImageOutputLanguage(prompt: string, locale: ImageStudioLocale): string {
  const hint = imageOutputLanguageHint(locale);
  if (prompt.includes(hint)) {
    return prompt;
  }
  return `${prompt}\n\n${hint}`;
}
