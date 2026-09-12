import { ApiError } from "../errors";

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const EFFORT_LIST = "none, low, medium, high, xhigh, max, or ultra";

/** Chat Thinking labels. Values on the wire stay the kernel strings. */
export const THINKING_LABELS: Record<ReasoningEffort, string> = {
  none: "Off",
  low: "Light",
  medium: "Normal",
  high: "Deep",
  xhigh: "Extra",
  max: "Max",
  ultra: "Ultra",
};

const EFFORTS = new Set<string>(REASONING_EFFORTS);

/** UI words only. Kernel members `xhigh`, `max`, and `ultra` are not aliases. */
const ALIASES: Record<string, ReasoningEffort> = {
  off: "none",
  light: "low",
  minimal: "low",
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

/** GPT-5.6 family hangs on Toko Token when reasoning_effort is none. */
export function coerceReasoningEffortForModel(modelId: string, effort: ReasoningEffort): ReasoningEffort {
  if (effort !== "none") {
    return effort;
  }
  const id = modelId.trim().toLowerCase();
  const leaf = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  if (/^gpt-5\.6|luna|sol|terra/.test(leaf) || /gpt-5\.6/.test(id)) {
    return "low";
  }
  return effort;
}

/**
 * Completions send the kernel string as-is (including xhigh, max, ultra).
 * Official OpenAI Responses still maps ultra → xhigh. `max` is never remapped.
 */
export function toWireReasoningEffort(
  effort: ReasoningEffort,
  options: { officialOpenAI?: boolean; responses?: boolean } = {},
): string {
  if (effort === "ultra" && options.officialOpenAI && options.responses) {
    return "xhigh";
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
