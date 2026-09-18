import { parseAppLocale, type AppLocale } from "../locale";

/** First try plus this many follow-ups. Three contact attempts, then a hard error. */
export const MODEL_CONTACT_ATTEMPTS = 3;

export function contactAttemptOrdinal(attempt: number, locale: AppLocale = "en"): string {
  if (parseAppLocale(locale) === "id") {
    return `ke-${attempt}`;
  }
  if (attempt === 1) {
    return "1st";
  }
  if (attempt === 2) {
    return "2nd";
  }
  if (attempt === 3) {
    return "3rd";
  }
  return `${attempt}th`;
}

export function formatContactProbe(
  model: string,
  attempt: number,
  attempts: number = MODEL_CONTACT_ATTEMPTS,
  locale: AppLocale = "en",
): string {
  const resolved = parseAppLocale(locale);
  const name = model.trim() || (resolved === "id" ? "model ini" : "this model");
  const ordinal = contactAttemptOrdinal(attempt, resolved);
  if (resolved === "id") {
    return attempt <= 1 ? `Menghubungi ${name} · percobaan ${ordinal}` : `Percobaan ${ordinal} · ${name}`;
  }
  if (attempt <= 1) {
    return `Probing ${name} · ${ordinal} try`;
  }
  return `${ordinal} try · ${name}`;
}

export function formatContactProbeButton(attempt: number, locale: AppLocale = "en"): string {
  const resolved = parseAppLocale(locale);
  const ordinal = contactAttemptOrdinal(Math.max(1, attempt), resolved);
  return resolved === "id" ? `Percobaan ${ordinal}…` : `${ordinal} try…`;
}

/**
 * Transport failures worth another try, in either locale. The Indonesian half mirrors the wording this
 * module and `stream-watchdog.ts` actually write ("tidak dapat menghubungi …", "Model tidak dapat
 * dihubungi.", "Stream model habis waktu"), so a retried Indonesian error classifies like its English
 * twin instead of falling through as a hard stop.
 *
 * `unreachable` and `no response within` are the gateway probe's own words. It knew `unavailable`
 * only, so "Gateway unreachable: no response within 10s" — a gateway that never answered at all —
 * was read as a hard stop and the job died on a blip. The auth and 4xx guards below still run first.
 */
const RETRYABLE_FAILURE =
  /no available channel|could not be contacted|could not reach|econnrefused|enotfound|etimedout|econnreset|socket hang up|fetch failed|failed to fetch|networkerror|network|timed? ?out|overloaded|unavailable|\b429\b|\b502\b|\b503\b|\b504\b|the model stream failed|terminated|aborted|connect|unreachable|no response within|tidak dapat dihubungi|tidak dapat menghubungi|tidak dapat dijangkau|habis waktu|kehabisan waktu|tidak tersedia|kelebihan beban|jaringan|koneksi|dibatalkan|dihentikan/i;

export function isRetryableModelFailure(failed: string): boolean {
  const text = failed.trim();
  if (!text) {
    return true;
  }
  if (/401|403|unauthorized|invalid api key|incorrect api key|forbidden/i.test(text)) {
    return false;
  }
  if (/model_not_found|does not exist|unknown model|not a valid model/i.test(text)) {
    return false;
  }
  if (/context length|maximum context|too many tokens/i.test(text)) {
    return false;
  }
  if (/\b400\b|invalid_request/i.test(text) && !/\b(429|502|503|504)\b/.test(text)) {
    return false;
  }
  // Watchdog timeouts are a hard stop, not a retry — in either locale.
  if (/no first token from |no stream events from |token pertama dari |peristiwa stream dari /i.test(text)) {
    return false;
  }
  return RETRYABLE_FAILURE.test(text);
}

export function shouldRetryModelContact(options: {
  failed: string;
  text: boolean;
  tooled: boolean;
  attempts: number;
}): boolean {
  if (options.attempts >= MODEL_CONTACT_ATTEMPTS) {
    return false;
  }
  if (options.text || options.tooled) {
    return false;
  }
  return isRetryableModelFailure(options.failed);
}

/** Strip a prior attempt's prefix so retries do not nest "Could not reach …" sentences. */
const CONTACT_ERROR_PREFIX =
  /^(?:Could not reach .+? after \d+ tr(?:y|ies)\.|Tidak dapat menghubungi .+? setelah \d+ percobaan\.)\s*/i;

export function formatModelContactError(
  model: string,
  attempts: number,
  lastError: string,
  locale: AppLocale = "en",
): string {
  const resolved = parseAppLocale(locale);
  const name = model.trim() || (resolved === "id" ? "model ini" : "this model");
  const detail = lastError.trim().replace(/\s+/g, " ").replace(CONTACT_ERROR_PREFIX, "");
  const known = detail.length > 0 && !/^the model stream failed$/i.test(detail);
  if (resolved === "id") {
    const tries = `${attempts} percobaan`;
    if (known) {
      return `Tidak dapat menghubungi ${name} setelah ${tries}. ${detail}`;
    }
    const advice = "Model tidak dapat dihubungi. Coba model lain, atau kirim lagi.";
    return `Tidak dapat menghubungi ${name} setelah ${tries}. ${advice}`;
  }
  const tries = attempts === 1 ? "1 try" : `${attempts} tries`;
  if (known) {
    return `Could not reach ${name} after ${tries}. ${detail}`;
  }
  return `Could not reach ${name} after ${tries}. The model could not be contacted. Try another model, or send again.`;
}

export function shouldRetryWithoutTools(options: {
  hasTools: boolean;
  text: boolean;
  failed: string;
  tooled: boolean;
}): boolean {
  if (!options.hasTools || options.tooled) {
    return false;
  }
  if (!options.text && !options.failed) {
    return true;
  }
  if (/temperature|must be omitted|top_p|topP|\bn\b must/i.test(options.failed)) {
    return false;
  }
  return /function tools|reasoning_effort/i.test(options.failed);
}

/** Empty assistant reply is only a hard failure when no tools ran (e.g. image_generate with no prose). */
export function shouldFailEmptyAssistant(options: {
  text: boolean;
  thinking: boolean;
  tooled: boolean;
}): boolean {
  return !options.text && !options.thinking && !options.tooled;
}

/** Keep a tool turn (image/video generate) even if a later provider fetch fails. */
export function shouldKeepToolTurn(options: { tooled: boolean; failed: string }): boolean {
  return options.tooled && options.failed.trim().length > 0;
}
