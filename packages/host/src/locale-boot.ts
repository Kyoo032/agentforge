import { isServerMode, type AppLocale } from "@agentforge/core";
import { loadOwnerLocale, loadUserLocale, type UserScope } from "./settings-store";

let frozen: AppLocale | null = null;

/**
 * Locale locked when this process first read owner settings.
 * Saving a new language does not change it. There is no product env override
 * (`AGENTFORGE_LOCALE` is not read here — turbo/`pnpm dev` does not pass it through).
 *
 * Desktop only, in the sense that matters: on a hosted server this is the install's locale, which
 * belongs to nobody in particular. `localeForRun` and `localePayload` take the caller's own locale
 * there and never reach this. See `docs/internal/web-phase4-tenant-secrets.md` §4.
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
 *
 * A no-op in server mode: the frozen locale is the whole process's, so one signed-in user must not
 * be able to re-point it, and they have no need to — a hosted user's language is applied on the
 * next request without a restart, because nothing freezes it.
 */
export function applySavedLocaleAsBoot(): AppLocale {
  if (isServerMode()) {
    return getBootLocale();
  }
  frozen = loadOwnerLocale();
  return frozen;
}

export function resetBootLocaleForTests(): void {
  frozen = null;
}

/**
 * What the Settings screen shows: `locale` is the language the app is rendering in now, and
 * `savedLocale` the one that has been chosen. When they differ the renderer offers Restart.
 *
 * With a `user`, both come from that person (Phase 4). On a desk `locale` stays the frozen boot
 * value, so a language change still asks for a restart exactly as before; in server mode nothing is
 * frozen per user, so the two agree and the Restart prompt never appears. Without a `user` — the
 * pre-auth ping — it is the install's pair, which is what it always was.
 */
export function localePayload(user?: UserScope): { locale: AppLocale; savedLocale: AppLocale } {
  if (!user) {
    return { locale: getBootLocale(), savedLocale: getSavedLocale() };
  }
  const saved = loadUserLocale(user);
  return { locale: isServerMode() ? saved : getBootLocale(), savedLocale: saved };
}
