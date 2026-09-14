export const APP_LOCALES = ["en", "id"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = "en";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "en" || value === "id";
}

/** Unknown or missing values become English. Do not treat a typo as Indonesian. */
export function parseAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_APP_LOCALE;
}
