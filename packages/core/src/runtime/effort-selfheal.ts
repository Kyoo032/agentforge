import {
  REASONING_LADDER,
  closestReasoningEffort,
  type ReasoningEffort,
} from "../models/reasoning-effort";
import { bareModelId } from "../models/request-constraints";

/**
 * When a gateway refuses the Thinking parameter on a request that has produced nothing yet, the
 * runtime retries once with a safer shape and remembers what worked for that model, so the next call
 * goes straight there. This file is the pure half: deciding that a 400 is about the effort
 * parameter, deciding how to back off, and the per-model memory. `effort-plan.ts` wires it to a run.
 */

/** A gateway HTTP failure as the runtime saw it: the status and the raw body, for classification only. */
export type GatewayFailureDetail = { status: number; body: string };

export type EffortRejection = {
  /** `value`: the level is not accepted, the parameter is. `parameter`: the model takes no such parameter. */
  kind: "value" | "parameter";
};

export type SaferEffort = { action: "step_down"; level: ReasoningEffort } | { action: "drop" };

/** What one retry that answered teaches about a model. */
export type LearnedEffortLimit =
  | { kind: "ceiling"; level: ReasoningEffort }
  | { kind: "drop" }
  | { kind: "replace"; from: ReasoningEffort; to: ReasoningEffort | undefined };

/** Everything remembered about one model, merged from what its retries taught. */
export type LearnedEffort = Readonly<{
  /** The model takes no effort parameter at all: send none, whatever the level. */
  drop: boolean;
  /** Levels above this were refused: hold higher ones here. */
  ceiling: ReasoningEffort | undefined;
  /** One level refused, and what to send instead (`"omit"`: no parameter). Other levels are untouched. */
  replace: Readonly<Partial<Record<ReasoningEffort, ReasoningEffort | "omit">>>;
}>;

/** Failures that mention the parameter's neighbours but are about something else. Checked first. */
const NOT_ABOUT_EFFORT =
  /context length|maximum context|too many tokens|model_not_found|model[^.]{0,60}does not exist|unknown model|not a valid model|invalid api key|incorrect api key|unauthorized|insufficient|quota|rate.?limit|function tools?|\/v1\/responses/i;

/** The text names the Thinking parameter (or one of its vendor spellings). */
const MENTIONS_EFFORT =
  /reasoning[_. -]?effort|\beffort\b|\bthinking\b|thinking[_-]?(?:budget|level|config)|budget_tokens|output_config|\breasoning\b/i;

/**
 * The gateway is refusing something, in words. Without one of these a mention is just a mention. A
 * bare "invalid" is not one: it is the `type` of nearly every 400 (`invalid_request_error`), and the
 * classifier reads the message, the parameter name and the code, never the type.
 */
const REFUSAL_WORDS =
  /unsupported|not supported|does not support|not support|invalid (?:value|effort|reasoning|thinking|level|argument|parameter|param)\b|unknown|unrecogni[sz]ed|unexpected|not (?:allowed|permitted|available|valid)|must be one of|should be one of|supported values|input should be|extra (?:inputs|fields)|additional properties|budget[^.]{0,20}(?:is )?invalid/i;

/** The level is what is wrong: a value list, or a quoted level next to a refusal. */
const VALUE_REJECTED =
  /unsupported value|invalid value|supported values|must be one of|should be one of|input should be|not a valid (?:value|effort|level)|['"`](?:none|minimal|low|medium|high|xhigh|max|ultra)['"`]|budget[^.]{0,20}(?:is )?invalid/i;

/** The parameter is what is wrong: the model has no such field. */
const PARAMETER_REJECTED =
  /unsupported parameter|unrecogni[sz]ed (?:request )?(?:argument|parameter|field)|unknown (?:parameter|field|argument|name)|unexpected (?:keyword|field|parameter)|extra (?:inputs|fields) (?:are )?not permitted|additional properties|(?:is|are) not (?:a )?(?:supported|permitted|allowed) (?:parameter|field|argument)|does not support (?:the )?(?:reasoning|thinking|effort)|(?:reasoning|thinking|effort)[^.]{0,60}(?:is|are) not supported/i;

const BODY_STATUS_400 = /"status_code"\s*:\s*(?:400|422)\b|status_code\s*=\s*(?:400|422)\b/;

function isRequestRejection(failure: GatewayFailureDetail): boolean {
  return failure.status === 400 || failure.status === 422 || BODY_STATUS_400.test(failure.body);
}

/**
 * What the gateway said, without what it filed the error under: the message, the parameter and the
 * code of a JSON error, or the whole text when it is not JSON. The `type` is left out on purpose.
 */
function refusalText(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const inner = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : record;
      const parts = [inner.message, inner.param, inner.code, record.message, record.detail]
        .filter((part): part is string => typeof part === "string");
      if (typeof record.error === "string") {
        parts.push(record.error);
      }
      if (parts.length > 0) {
        return parts.join(" ");
      }
    }
  } catch {
    // Not JSON: classify the raw text.
  }
  return body;
}

/**
 * Is this failure the gateway refusing the Thinking parameter? Only a 400 or 422 whose text both names
 * the parameter and says it is refused counts; a context-length error, a bad key, an unknown model
 * or a malformed body never do, so a real problem is never masked by a quiet retry.
 */
export function classifyEffortRejection(failure: GatewayFailureDetail): EffortRejection | null {
  if (!failure.body.trim() || !isRequestRejection(failure)) {
    return null;
  }
  const text = refusalText(failure.body);
  if (NOT_ABOUT_EFFORT.test(text)) {
    return null;
  }
  if (!MENTIONS_EFFORT.test(text) || !REFUSAL_WORDS.test(text)) {
    return null;
  }
  return PARAMETER_REJECTED.test(text) && !VALUE_REJECTED.test(text) ? { kind: "parameter" } : { kind: "value" };
}

const LADDER_INDEX: Record<ReasoningEffort, number> = Object.fromEntries(
  REASONING_LADDER.map((level, index) => [level, index]),
) as Record<ReasoningEffort, number>;

/**
 * The safer shape for a rejected request: one step down within the model's allowed list, or, when the
 * level was already the lowest or the model takes no such parameter, none at all. `null` when no
 * effort was sent, so there is nothing to back off from.
 */
export function saferEffortAction(
  current: ReasoningEffort | undefined,
  allowed: readonly ReasoningEffort[],
  rejection: EffortRejection,
): SaferEffort | null {
  if (current === undefined) {
    return null;
  }
  if (rejection.kind === "parameter") {
    return { action: "drop" };
  }
  const below = allowed
    .filter((level) => LADDER_INDEX[level] < LADDER_INDEX[current])
    .sort((a, b) => LADDER_INDEX[b] - LADDER_INDEX[a])[0];
  return below === undefined ? { action: "drop" } : { action: "step_down", level: below };
}

/**
 * What a retry that answered teaches. A refused parameter teaches that the model takes none. A refused
 * level from Deep up teaches a ceiling, because a gateway that refuses Extra refuses Max and Ultra too.
 * A refused level below that (Off, Light, Normal, or Deep on a model with nothing above) teaches only
 * that level: refusing Off says nothing about Deep, so the model keeps every other level.
 */
export function limitFromHeal(
  rejected: ReasoningEffort,
  sent: ReasoningEffort | undefined,
  rejection: EffortRejection,
): LearnedEffortLimit {
  if (rejection.kind === "parameter") {
    return { kind: "drop" };
  }
  if (sent !== undefined && LADDER_INDEX[rejected] > LADDER_INDEX.high) {
    return { kind: "ceiling", level: sent };
  }
  return { kind: "replace", from: rejected, to: sent };
}

/**
 * Hold a level at a learned ceiling: the ceiling itself when the model allows it, the nearest allowed
 * level under it otherwise. A level already at or under the ceiling, or a list with nothing under it,
 * is returned as it is.
 */
export function capEffortAtCeiling(
  level: ReasoningEffort,
  ceiling: ReasoningEffort,
  allowed: readonly ReasoningEffort[],
): ReasoningEffort {
  if (LADDER_INDEX[level] <= LADDER_INDEX[ceiling]) {
    return level;
  }
  const under = allowed.filter((candidate) => LADDER_INDEX[candidate] <= LADDER_INDEX[ceiling]);
  return under.length === 0 ? level : closestReasoningEffort(ceiling, under);
}

/** More than the catalog ever lists; the cap only stops a stream of made-up ids from growing the map. */
export const LEARNED_EFFORT_LIMIT_CAP = 128;

/**
 * How long a learned limit holds. One refusal can come from a single upstream channel or a passing
 * gateway rule, so nothing learned is permanent: after this the next call tries the full level again
 * and relearns it if the gateway still refuses. The job-model breaker holds for five minutes.
 */
export const LEARNED_EFFORT_LIMIT_TTL_MS = 30 * 60 * 1000;

type Stored = { state: LearnedEffort; expiresAt: number };

const learned = new Map<string, Stored>();

function storeKey(modelId: string, scope: string): string | undefined {
  const model = bareModelId(modelId);
  return model ? `${scope}::${model}` : undefined;
}

/**
 * What is remembered about `modelId` for `scope` (a tenant: what one tenant's gateway key or channel
 * refused says nothing about another's), or undefined once it has expired or was never learned.
 */
export function learnedEffortLimit(modelId: string, scope = "", now: number = Date.now()): LearnedEffort | undefined {
  const key = storeKey(modelId, scope);
  const stored = key ? learned.get(key) : undefined;
  if (!key || !stored) {
    return undefined;
  }
  if (now >= stored.expiresAt) {
    learned.delete(key);
    return undefined;
  }
  return stored.state;
}

function merge(existing: LearnedEffort | undefined, limit: LearnedEffortLimit): LearnedEffort {
  const base: LearnedEffort = existing ?? { drop: false, ceiling: undefined, replace: {} };
  if (limit.kind === "drop") {
    return { ...base, drop: true };
  }
  if (limit.kind === "ceiling") {
    const stricter =
      base.ceiling !== undefined && LADDER_INDEX[base.ceiling] <= LADDER_INDEX[limit.level] ? base.ceiling : limit.level;
    return { ...base, ceiling: stricter };
  }
  return { ...base, replace: { ...base.replace, [limit.from]: limit.to ?? "omit" } };
}

/** Add what a retry taught. Stricter wins where two lessons overlap, and every lesson restarts the clock. */
export function rememberEffortLimit(
  modelId: string,
  limit: LearnedEffortLimit,
  scope = "",
  now: number = Date.now(),
): void {
  const key = storeKey(modelId, scope);
  if (!key) {
    return;
  }
  const state = merge(learnedEffortLimit(modelId, scope, now), limit);
  learned.delete(key);
  learned.set(key, { state, expiresAt: now + LEARNED_EFFORT_LIMIT_TTL_MS });
  while (learned.size > LEARNED_EFFORT_LIMIT_CAP) {
    const oldest = learned.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    learned.delete(oldest);
  }
}

/**
 * Forget every learned limit. Saving Settings calls this with the job breaker: a new key or endpoint
 * may sit in front of a different upstream, so what was learned about a model no longer holds.
 */
export function resetLearnedEffortLimits(): void {
  learned.clear();
}
