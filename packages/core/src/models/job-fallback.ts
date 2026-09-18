import { firstLiveId } from "./media-kind";
import { JOB_MODE_PREFERENCES, type JobMode } from "./mode-defaults";

/**
 * Notice code a job result carries when it answered on a model the person did not ask for.
 * The desk turns the code plus the two ids into its own sentence ("<from> is unavailable; used
 * <to>"), so no half of that sentence is written here and neither locale is hardcoded.
 */
export const MODEL_FALLBACK_NOTICE = "model_fallback";

export type JobModelFallbackNotice = {
  code: typeof MODEL_FALLBACK_NOTICE;
  /** The model the request asked for and could not reach. */
  from: string;
  /** The model that actually answered. */
  to: string;
};

export function modelFallbackNotice(from: string, to: string): JobModelFallbackNotice {
  return { code: MODEL_FALLBACK_NOTICE, from, to };
}

/**
 * Ranked stand-ins every job mode may borrow once its own preference list runs out. Kept separate
 * from `JOB_MODE_PREFERENCES` on purpose: that list decides which model a mode gets on a healthy
 * gateway (`resolveModeDefaults`), and reordering its head would move every desk's default. This
 * list only ever runs when the first choice could not be reached.
 *
 * The order is what the gateway actually answered on 2026-09-17: `gpt-5.6-luna` and
 * `claude-sonnet-5` returned briefs, while `deepseek-v4-flash`, `gpt-5.6-terra` and `glm-5.2` all
 * came back 503. Both leaders hold long numeric tables and strict JSON well, which is what a
 * Finance or Data job asks for; `gpt-5.6-sol` and `kimi-k3` follow as the larger everyday models
 * Legal already ranks for the same reason. Nothing here is assumed live — every id is intersected
 * with the workspace catalog before it is offered.
 */
export const JOB_FALLBACK_TAIL = ["gpt-5.6-luna", "claude-sonnet-5", "gpt-5.6-sol", "kimi-k3"];

/**
 * The gateway could not answer at all, so the same prompt on another model is worth one try.
 * Covers the three shapes the eval run produced — the 5xx sentence from `gatewayHttpFailure`, the
 * 10 s response-header abort in `ai-sdk-runtime.ts`, and the first-token watchdog — in both locales.
 */
const GATEWAY_UNAVAILABLE =
  /\b50[234]\b|unavailable|unreachable|no available channel|could not reach|could not be contacted|econnrefused|enotfound|etimedout|econnreset|socket hang up|fetch failed|failed to fetch|no response within|no first token from|no stream events from|tidak tersedia|tidak dapat dihubungi|tidak dapat menghubungi|tidak dapat dijangkau|token pertama dari|peristiwa stream dari/i;

/**
 * Failures a second model would hit the same way (the key, the endpoint) or differently in a way
 * the person must see (a rejected prompt, a filtered answer). Swapping the model would hide a
 * wrong key behind a mystery model change, so these are checked first and always win.
 *
 * "returned no text" belongs here even though the runtime wraps it in the same "Could not reach X
 * after N tries" sentence as a real outage: the model answered, with nothing. That is a wire or a
 * tools mismatch for this model, and swapping models would hide it.
 */
const NOT_A_TRANSPORT_FAILURE =
  /\b(400|401|403|404|422|429)\b|unauthorized|forbidden|invalid api key|incorrect api key|model_not_found|does not exist|unknown model|not a valid model|context length|maximum context|too many tokens|invalid_request|content[ _]filter|content policy|rate.?limit|returned no text|tidak ada teks|tidak menerima api key|menolak permintaan|membatasi laju/i;

/** True only for a transport-class failure: the caller may retry this prompt on another model. */
export function isGatewayUnavailableFailure(message: string): boolean {
  const text = message.trim();
  if (!text) {
    return false;
  }
  if (NOT_A_TRANSPORT_FAILURE.test(text)) {
    return false;
  }
  return GATEWAY_UNAVAILABLE.test(text);
}

/**
 * The models this mode may run on, best first, in the workspace's own spelling. A hint that the
 * workspace does not list is dropped, so the chain can never name a model the gateway has not
 * offered. An unknown mode still gets the shared tail — every job is worth one more try.
 */
export function jobFallbackChain(mode: JobMode | undefined, availableIds: string[]): string[] {
  const ranked = mode ? [...JOB_MODE_PREFERENCES[mode], ...JOB_FALLBACK_TAIL] : JOB_FALLBACK_TAIL;
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const want of ranked) {
    const live = firstLiveId([want], availableIds);
    if (!live || seen.has(live.toLowerCase())) {
      continue;
    }
    seen.add(live.toLowerCase());
    chain.push(live);
  }
  return chain;
}

/**
 * The best model to try after `current` failed: the top of the chain that is neither `current` nor
 * marked down. `undefined` means there is nowhere left to go and the caller must surface the error.
 */
export function nextJobFallbackModel(options: {
  mode?: JobMode;
  current: string;
  availableIds: string[];
  isDown?: (model: string) => boolean;
}): string | undefined {
  const current = options.current.trim().toLowerCase();
  const isDown = options.isDown ?? (() => false);
  return jobFallbackChain(options.mode, options.availableIds).find(
    (id) => id.toLowerCase() !== current && !isDown(id),
  );
}
