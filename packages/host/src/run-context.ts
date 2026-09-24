import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_APP_LOCALE, type AppLocale } from "@agentforge/core";
import { getBootLocale } from "./locale-boot";
import { log } from "./log";

export type RunContext = {
  threadId: string;
  agentId: string;
  locale: AppLocale;
};

const storage = new AsyncLocalStorage<RunContext>();

export function withRunContext<T>(context: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function getRunContext(): RunContext | undefined {
  return storage.getStore();
}

/**
 * The locale of the person a hosted request belongs to, for its handler and everything it awaits.
 *
 * `dispatch` (`./router.ts`) sets it for every request that passed the session gate, beside the
 * session itself. Before it did, only Chat carried the person's language (its own `withRunContext`,
 * `./runs.ts`), so every other mode on the hosted server answered in the process's boot locale — the
 * install's, which belongs to nobody in particular. Off server mode nothing sets it, so the desktop
 * and webdev keep the frozen boot locale exactly as before.
 *
 * Held as a reader, not a value: the settings payload is only read when a handler actually asks,
 * and at most once per request, so a request that never writes copy costs nothing.
 */
const requestLocale = new AsyncLocalStorage<() => AppLocale>();

/**
 * Run `fn` with `resolve` as this request's locale. A `resolve` that throws — an unreadable
 * payload, a wrap-key fault — answers English, the same thing a person with no saved choice gets,
 * rather than failing a request that only wanted copy. The failure is logged, not swallowed; the
 * handler meets the same fault on its own settings read and reports it there.
 */
export function withRequestLocale<T>(resolve: () => AppLocale, fn: () => Promise<T>): Promise<T> {
  let resolved: AppLocale | null = null;
  const read = (): AppLocale => {
    if (resolved === null) {
      resolved = readOrDefault(resolve);
    }
    return resolved;
  };
  return requestLocale.run(read, fn);
}

function readOrDefault(resolve: () => AppLocale): AppLocale {
  try {
    return resolve();
  } catch (error) {
    log.warn("request_locale_unreadable", { detail: error instanceof Error ? error.message : "unknown" });
    return DEFAULT_APP_LOCALE;
  }
}

/** Most specific first: a Chat run's own context, then the request's person, then the boot locale. */
export function localeForRun(): AppLocale {
  return getRunContext()?.locale ?? requestLocale.getStore()?.() ?? getBootLocale();
}
