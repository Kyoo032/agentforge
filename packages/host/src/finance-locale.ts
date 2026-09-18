/**
 * Which language a Finance run answers in.
 *
 * The studio sends the locale on the request because the owner can be reading an Indonesian statement
 * in an English app, or the other way round. Reading it from the boot locale instead is how an
 * Indonesian sheet came back as an English brief with "29.1282%" in the middle of a sentence.
 *
 * A locale the app does not ship falls back to the run's own locale rather than to English: the run
 * context is still a better guess than a default, and a typo in a request must never silently switch
 * the owner's language.
 */
import { isAppLocale, type AppLocale } from "@agentforge/core";
import { localeForRun } from "./run-context";

export function readFinanceLocale(body: unknown): AppLocale {
  const value = (body as { locale?: unknown } | null)?.locale;
  return isAppLocale(value) ? value : localeForRun();
}
