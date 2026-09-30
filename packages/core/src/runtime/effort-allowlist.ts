import {
  allowedEffortsFor,
  modelPolicy,
  ANTHROPIC_MESSAGES_EFFORTS,
  GEMINI_EFFORTS,
  GPT_56_EFFORTS,
  GPT_6_EFFORTS,
  OFFICIAL_OPENAI_EFFORTS,
  TOKO_COMPLETIONS_EFFORTS,
  TOKO_RESPONSES_EFFORTS,
  UNKNOWN_MODEL_EFFORTS,
} from "../models/model-policy";
import { closestReasoningEffort, type ReasoningEffort } from "../models/reasoning-effort";
import { resolveChatWire, type ResolvedChatWire } from "./chat-wire";

/**
 * The per-model level lists live in `models/model-policy.ts`, next to the rest of what a model
 * needs. They are re-exported here because callers have always imported them from this file.
 */
export {
  ANTHROPIC_MESSAGES_EFFORTS,
  GEMINI_EFFORTS,
  GPT_56_EFFORTS,
  GPT_6_EFFORTS,
  OFFICIAL_OPENAI_EFFORTS,
  TOKO_COMPLETIONS_EFFORTS,
  TOKO_RESPONSES_EFFORTS,
  UNKNOWN_MODEL_EFFORTS,
};

export function allowedReasoningEfforts(
  modelId: string,
  options: { wire: ResolvedChatWire; officialOpenAI?: boolean },
): ReasoningEffort[] {
  return allowedEffortsFor(modelPolicy(modelId), options.wire, options.officialOpenAI === true);
}

export function snapReasoningEffort(
  modelId: string,
  requested: ReasoningEffort,
  options: { wire?: ResolvedChatWire; officialOpenAI?: boolean } = {},
): ReasoningEffort {
  const wire = options.wire ?? resolveChatWire("auto", modelId);
  return closestReasoningEffort(requested, allowedReasoningEfforts(modelId, { wire, officialOpenAI: options.officialOpenAI }));
}
