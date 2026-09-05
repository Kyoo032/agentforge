/** First try plus this many follow-ups. Three contact attempts, then a hard error. */
export const MODEL_CONTACT_ATTEMPTS = 3;

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
  if (/no first token from |no stream events from /i.test(text)) {
    return false;
  }
  return /no available channel|could not be contacted|could not reach|econnrefused|enotfound|etimedout|econnreset|socket hang up|fetch failed|failed to fetch|networkerror|network|timed? ?out|overloaded|unavailable|\b429\b|\b502\b|\b503\b|\b504\b|the model stream failed|terminated|aborted|connect/i.test(
    text,
  );
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

export function formatModelContactError(model: string, attempts: number, lastError: string): string {
  const name = model.trim() || "this model";
  const tries = attempts === 1 ? "1 try" : `${attempts} tries`;
  const detail = lastError
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^Could not reach .+? after \d+ tries\.\s*/i, "");
  if (detail && !/^the model stream failed$/i.test(detail)) {
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
