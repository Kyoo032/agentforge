import { bareModelId } from "../models/request-constraints";
import {
  closestReasoningEffort,
  type ReasoningEffort,
} from "../models/reasoning-effort";
import { resolveChatWire, type ResolvedChatWire } from "./chat-wire";

/** Toko Completions: pass through including ultra. Keep xhigh/max so they are not snapped to ultra. */
export const TOKO_COMPLETIONS_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

/** Official OpenAI Completions + Responses. No ultra. */
export const OFFICIAL_OPENAI_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** GPT-5.6 Sol/Terra/Luna: none is allowed; no minimal; no ultra. */
export const GPT_56_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/** GPT-6: no none (start at low); no ultra. */
export const GPT_6_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

/** Anthropic Messages `output_config.effort`. Off is thinking.disabled. No ultra. */
export const ANTHROPIC_MESSAGES_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

/** Gemini thinkingConfig. Extra/Max/Ultra snap to Deep (`high`). */
export const GEMINI_EFFORTS = ["none", "low", "medium", "high"] as const;

/** Toko Responses: ultra is unproven — snap Ultra to max. */
export const TOKO_RESPONSES_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

function isGpt6(modelId: string): boolean {
  const id = bareModelId(modelId);
  return /^gpt-6/.test(id) || id.includes("astra");
}

function isGpt56Family(modelId: string): boolean {
  const id = bareModelId(modelId);
  return /^gpt-5\.6/.test(id);
}

function asEfforts(values: readonly ReasoningEffort[]): ReasoningEffort[] {
  return [...values];
}

export function allowedReasoningEfforts(
  modelId: string,
  options: { wire: ResolvedChatWire; officialOpenAI?: boolean },
): ReasoningEffort[] {
  if (options.wire === "anthropic_messages") {
    return asEfforts(ANTHROPIC_MESSAGES_EFFORTS);
  }
  if (options.wire === "google_generate_content") {
    return asEfforts(GEMINI_EFFORTS);
  }
  if (isGpt6(modelId)) {
    return asEfforts(GPT_6_EFFORTS);
  }
  if (options.officialOpenAI) {
    if (isGpt56Family(modelId)) {
      return asEfforts(GPT_56_EFFORTS);
    }
    return asEfforts(OFFICIAL_OPENAI_EFFORTS);
  }
  if (options.wire === "responses") {
    if (isGpt56Family(modelId)) {
      return asEfforts(GPT_56_EFFORTS);
    }
    return asEfforts(TOKO_RESPONSES_EFFORTS);
  }
  if (isGpt56Family(modelId)) {
    return asEfforts(GPT_56_EFFORTS);
  }
  return asEfforts(TOKO_COMPLETIONS_EFFORTS);
}

export function snapReasoningEffort(
  modelId: string,
  requested: ReasoningEffort,
  options: { wire?: ResolvedChatWire; officialOpenAI?: boolean } = {},
): ReasoningEffort {
  const wire = options.wire ?? resolveChatWire("auto", modelId);
  return closestReasoningEffort(requested, allowedReasoningEfforts(modelId, { wire, officialOpenAI: options.officialOpenAI }));
}
