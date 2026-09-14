import type { AppLocale } from "@agentforge/core";
import { loadOwnerLocale } from "./settings-store";

let frozen: AppLocale | null = null;

/**
 * Locale locked when this process first read owner settings.
 * Saving a new language does not change it. There is no product env override
 * (`AGENTFORGE_LOCALE` is not read here — turbo/`pnpm dev` does not pass it through).
 */
export function getBootLocale(): AppLocale {
  if (frozen === null) {
    frozen = loadOwnerLocale();
  }
  return frozen;
}

export function getSavedLocale(): AppLocale {
  return loadOwnerLocale();
}

/**
 * The Restart control in Settings. Reloading the renderer does not restart this
 * process (webdev or packaged IPC), so boot locale must be re-read from disk here.
 */
export function applySavedLocaleAsBoot(): AppLocale {
  frozen = loadOwnerLocale();
  return frozen;
}

export function resetBootLocaleForTests(): void {
  frozen = null;
}

export function localePayload(): { locale: AppLocale; savedLocale: AppLocale } {
  return { locale: getBootLocale(), savedLocale: getSavedLocale() };
}
