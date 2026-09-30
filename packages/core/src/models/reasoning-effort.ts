import { ApiError } from "../errors";
import { floorEffort, modelPolicy, offFormatFor } from "./model-policy";

/** Host ladder including snap-only `minimal`. Do not alias xhigh/max → ultra. */
export const REASONING_LADDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffort = (typeof REASONING_LADDER)[number];

/** Chat Thinking options. `minimal` is internal snap-only. */
export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ChatReasoningEffort = (typeof REASONING_EFFORTS)[number];

const EFFORT_LIST = "none, minimal, low, medium, high, xhigh, max, or ultra";

const LADDER_INDEX: Record<ReasoningEffort, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
  ultra: 7,
};

/** Chat Thinking labels. Picker keeps all seven; the host snaps silently per model. */
export const THINKING_LABELS: Record<ChatReasoningEffort, string> = {
  none: "Off",
  low: "Light",
  medium: "Normal",
  high: "Deep",
  xhigh: "Extra",
  max: "Max",
  ultra: "Ultra",
};

const EFFORTS = new Set<string>(REASONING_LADDER);

/** UI words only. Kernel members `minimal`, `xhigh`, `max`, and `ultra` are not aliases. */
const ALIASES: Record<string, ReasoningEffort> = {
  off: "none",
  light: "low",
  normal: "medium",
  med: "medium",
  deep: "high",
  extra: "xhigh",
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && EFFORTS.has(value);
}

export function resolveRequestReasoningEffort(input: {
  thinking?: boolean;
  reasoningEffort?: ReasoningEffort;
}): ReasoningEffort {
  if (input.reasoningEffort) {
    if (input.thinking === false && input.reasoningEffort !== "none") {
      return "none";
    }
    return input.reasoningEffort;
  }
  if (input.thinking === false) {
    return "none";
  }
  return "medium";
}

/** A Thinking level, and whether the person picked it or the host filled in `medium`. */
export type ReasoningEffortChoice = { effort: ReasoningEffort; explicit: boolean };

/**
 * The Thinking level a request asks for. `explicit` is true only when the body carries a level or
 * `thinking: false`. A body that says nothing gets `medium` with `explicit: false`, so a model the
 * policy table does not know can be sent no effort at all (`models/model-policy.ts`) instead of a
 * level nobody asked for.
 */
export function readReasoningEffortChoice(body: unknown): ReasoningEffortChoice {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { effort: "medium", explicit: false };
  }
  const record = body as { reasoningEffort?: unknown; thinking?: unknown };
  if (record.reasoningEffort !== undefined && record.reasoningEffort !== null) {
    if (typeof record.reasoningEffort !== "string") {
      throw new ApiError("invalid_request", `reasoningEffort must be ${EFFORT_LIST}`, 400);
    }
    const normalized = record.reasoningEffort.trim().toLowerCase();
    const aliased = ALIASES[normalized];
    if (aliased) {
      return { effort: aliased, explicit: true };
    }
    if (!isReasoningEffort(normalized)) {
      throw new ApiError("invalid_request", `reasoningEffort must be ${EFFORT_LIST}`, 400);
    }
    if (record.thinking === false && normalized !== "none") {
      return { effort: "none", explicit: true };
    }
    return { effort: normalized, explicit: true };
  }
  if (record.thinking === false) {
    return { effort: "none", explicit: true };
  }
  return { effort: "medium", explicit: false };
}

export function readOptionalReasoningEffort(body: unknown): ReasoningEffort {
  return readReasoningEffortChoice(body).effort;
}

/**
 * Did the person choose this Thinking level? The host's parsed flag wins; a caller that passes only
 * a level (or `thinking: false`) chose it; a caller that passes nothing did not.
 */
export function isReasoningEffortExplicit(input: {
  thinking?: boolean;
  reasoningEffort?: ReasoningEffort;
  reasoningEffortExplicit?: boolean;
}): boolean {
  if (input.reasoningEffortExplicit !== undefined) {
    return input.reasoningEffortExplicit;
  }
  return input.reasoningEffort !== undefined || input.thinking === false;
}

/**
 * Closest allowed effort on the ladder. Tie → lower (cheaper).
 * Never upgrades Off to a thinking-on level when `none` is allowed.
 */
export function closestReasoningEffort(
  requested: ReasoningEffort,
  allowed: readonly ReasoningEffort[],
): ReasoningEffort {
  if (allowed.length === 0) {
    return requested;
  }
  if (allowed.includes(requested)) {
    return requested;
  }
  if (requested === "none" && allowed.includes("none")) {
    return "none";
  }
  const req = LADDER_INDEX[requested];
  const first = allowed[0];
  if (first === undefined) {
    return requested;
  }
  let best = first;
  let bestDist = Math.abs(LADDER_INDEX[best] - req);
  for (const candidate of allowed) {
    const dist = Math.abs(LADDER_INDEX[candidate] - req);
    if (dist < bestDist || (dist === bestDist && LADDER_INDEX[candidate] < LADDER_INDEX[best])) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * A model that cannot be turned off (GPT-6) lifts Off to its lowest level. Which models those are,
 * and what the lowest level is, is declared in `models/model-policy.ts`; per-wire allowlists are
 * `runtime/effort-allowlist.ts`.
 */
export function coerceReasoningEffortForModel(modelId: string, effort: ReasoningEffort): ReasoningEffort {
  if (effort !== "none") {
    return effort;
  }
  const policy = modelPolicy(modelId);
  if (offFormatFor(policy, "responses") !== "floor") {
    return effort;
  }
  return floorEffort(policy) ?? effort;
}

/**
 * Completions send the kernel string as-is after snap.
 * Official OpenAI never receives `ultra` — Codex maps it to `max`.
 */
export function toWireReasoningEffort(
  effort: ReasoningEffort,
  options: { officialOpenAI?: boolean; responses?: boolean } = {},
): string {
  if (effort === "ultra" && options.officialOpenAI) {
    return "max";
  }
  return effort;
}

/** Chat-completions gateways read `reasoning_effort`. Do not add it on /responses. */
export function applyReasoningEffortToChatBody(body: unknown, effort: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }
  return { ...(body as Record<string, unknown>), reasoning_effort: effort };
}

/**
 * The Responses `reasoning` block for a model the AI SDK does not know as a reasoning model.
 *
 * `@ai-sdk/openai` 1.3.24 writes `reasoning: { effort, summary }` only for ids that start with `o` or
 * `gpt-5` (`getResponsesModelConfig`), so GPT-6 and a GPT newer than that went to /responses with the
 * level the person chose silently dropped. The runtime calls this on the outgoing /responses body and
 * gets the block the SDK would have written for gpt-5.x: same shape (`summary: "auto"` for every level
 * but Off, which is `{ effort: "none" }` alone) and the same place in the body, right after `input`.
 *
 * A body that already carries a `reasoning` block is the SDK's own and comes back untouched, so a
 * model the SDK does handle is never rewritten. Never mutates.
 */
export function applyReasoningToResponsesBody(body: unknown, effort: string): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }
  const record = body as Record<string, unknown>;
  if ("reasoning" in record) {
    return body;
  }
  const reasoning = effort === "none" ? { effort } : { effort, summary: "auto" };
  const next: Record<string, unknown> = {};
  let placed = false;
  for (const [key, value] of Object.entries(record)) {
    next[key] = value;
    if (key === "input") {
      next.reasoning = reasoning;
      placed = true;
    }
  }
  if (!placed) {
    next.reasoning = reasoning;
  }
  return next;
}

/** The chat-completions body with no `reasoning_effort`. The same body back when it has none. */
export function withoutReasoningEffort(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }
  if (!("reasoning_effort" in body)) {
    return body;
  }
  const { reasoning_effort: _dropped, ...rest } = body as Record<string, unknown>;
  return rest;
}

export function isChatCompletionsUrl(url: unknown): boolean {
  return /\/chat\/completions(?:\?|$)/.test(String(url));
}
