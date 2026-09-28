import { parseAppLocale, type AppLocale } from "../locale";

export type MeetingPhaseLabel =
  | "writing"
  | "writing-again"
  | "grounding"
  | "saving"
  | "translating"
  | "translating-again";

const PHASE: Record<MeetingPhaseLabel, Record<AppLocale, string>> = {
  writing: { en: "Writing the minutes", id: "Menulis notulen" },
  "writing-again": { en: "Writing the minutes again", id: "Menulis notulen sekali lagi" },
  grounding: {
    en: "Checking names, dates, and figures",
    id: "Memeriksa nama, tanggal, dan angka",
  },
  saving: { en: "Saving the minutes", id: "Menyimpan notulen" },
  translating: { en: "Translating the minutes", id: "Menerjemahkan notulen" },
  "translating-again": { en: "Translating the minutes again", id: "Menerjemahkan notulen sekali lagi" },
};

/** Progress label for the desk. Follows the desk locale, not the language the minutes are written in. */
export function meetingPhaseLabel(phase: MeetingPhaseLabel, locale: AppLocale): string {
  return PHASE[phase][parseAppLocale(locale)];
}

/** Told to the model when the first answer was not the minutes sheet. Follows the minutes language. */
export function minutesShapeRetryNote(locale: AppLocale): string {
  const copy: Record<AppLocale, string> = {
    en: "The previous answer was not the minutes JSON. Return only the JSON object in the requested shape.",
    id: "Jawaban sebelumnya bukan JSON notulen. Kembalikan hanya objek JSON dengan bentuk yang diminta.",
  };
  return copy[parseAppLocale(locale)];
}

/** Told to the model when the first translation changed the sheet. Follows the target language. */
export function translationRetryNote(locale: AppLocale): string {
  const copy: Record<AppLocale, string> = {
    en: "The previous translation changed the sheet. Keep the same counts, owners, dates, figures, and markers.",
    id: "Terjemahan sebelumnya mengubah lembarnya. Pertahankan jumlah butir, penanggung jawab, tanggal, angka, dan setiap penanda.",
  };
  return copy[parseAppLocale(locale)];
}

export function emptyMinutesMessage(locale: AppLocale): string {
  const copy: Record<AppLocale, string> = {
    en: "The model returned no minutes.",
    id: "Model tidak mengembalikan notulen.",
  };
  return copy[parseAppLocale(locale)];
}

export function invalidMinutesMessage(locale: AppLocale): string {
  const copy: Record<AppLocale, string> = {
    en: "The model returned minutes that are not the sheet.",
    id: "Model mengembalikan notulen yang bukan lembar itu.",
  };
  return copy[parseAppLocale(locale)];
}

/** Shown on the desk when the other language still does not match. Follows the desk locale. */
export function translationDisagreedMessage(locale: AppLocale): string {
  const copy: Record<AppLocale, string> = {
    en: "The other language did not match these minutes, so only this set was kept.",
    id: "Bahasa satunya tidak sama dengan notulen ini, jadi hanya set ini yang disimpan.",
  };
  return copy[parseAppLocale(locale)];
}
