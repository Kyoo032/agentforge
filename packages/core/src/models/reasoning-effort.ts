import { ApiError } from "../errors";

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

export function readOptionalReasoningEffort(body: unknown): ReasoningEffort {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "medium";
  }
  const record = body as { reasoningEffort?: unknown; thinking?: unknown };
  if (record.reasoningEffort !== undefined && record.reasoningEffort !== null) {
    if (typeof record.reasoningEffort !== "string") {
      throw new ApiError("invalid_request", `reasoningEffort must be ${EFFORT_LIST}`, 400);
    }
    const normalized = record.reasoningEffort.trim().toLowerCase();
    const aliased = ALIASES[normalized];
    if (aliased) {
      return aliased;
    }
    if (!isReasoningEffort(normalized)) {
      throw new ApiError("invalid_request", `reasoningEffort must be ${EFFORT_LIST}`, 400);
    }
    if (record.thinking === false && normalized !== "none") {
      return "none";
    }
    return normalized;
  }
  if (record.thinking === false) {
    return "none";
  }
  return "medium";
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

/** GPT-6 does not support `none`. Per-model allowlists live in `runtime/effort-allowlist.ts`. */
export function coerceReasoningEffortForModel(modelId: string, effort: ReasoningEffort): ReasoningEffort {
  if (effort !== "none") {
    return effort;
  }
  const id = modelId.trim().toLowerCase();
  const leaf = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  if (/^gpt-6/.test(leaf) || leaf.includes("astra") || /gpt-6/.test(id)) {
    return "low";
  }
  return effort;
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

export function isChatCompletionsUrl(url: unknown): boolean {
  return /\/chat\/completions(?:\?|$)/.test(String(url));
}
