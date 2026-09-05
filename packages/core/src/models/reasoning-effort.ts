import { ApiError } from "../errors";

export const REASONING_EFFORTS = ["none", "low", "medium", "high", "ultra"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

const EFFORTS = new Set<string>(REASONING_EFFORTS);

const ALIASES: Record<string, ReasoningEffort> = {
  off: "none",
  minimal: "low",
  med: "medium",
  max: "ultra",
  xhigh: "ultra",
  extra: "ultra",
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
      throw new ApiError("invalid_request", "reasoningEffort must be none, low, medium, high, or ultra", 400);
    }
    const normalized = record.reasoningEffort.trim().toLowerCase();
    const aliased = ALIASES[normalized];
    if (aliased) {
      return aliased;
    }
    if (!isReasoningEffort(normalized)) {
      throw new ApiError("invalid_request", "reasoningEffort must be none, low, medium, high, or ultra", 400);
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

/** Official OpenAI uses xhigh; the gateway keeps ultra. */
export function toWireReasoningEffort(
  effort: ReasoningEffort,
  options: { officialOpenAI?: boolean } = {},
): string {
  if (effort === "ultra" && options.officialOpenAI) {
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
