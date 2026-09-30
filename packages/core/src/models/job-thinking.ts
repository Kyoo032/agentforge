import type { JobMode } from "./mode-defaults";
import { modelPolicy } from "./model-policy";
import { isReasoningEffort, type ReasoningEffort } from "./reasoning-effort";

/**
 * Least-thinking knob per gateway family, for the families `QUIET_REASONING_FAMILY` in
 * `packages/core/src/runtime/stream-watchdog.ts` waits longer for: they think before they answer
 * and stream that thinking as `reasoning_content`, which AI SDK 4 drops. Keep the two lists
 * together — `job-thinking.test.ts` fails if they drift.
 *
 * The knob itself is the `jobThinking` field of the family's entry in `model-policy.ts`, with the
 * note on when it was seen. Only `reasoning_effort` is ever sent. The vendor knobs in section 3 of
 * docs/internal/gateway-model-selection.md (DeepSeek `thinking: {type: "disabled"}`, Qwen
 * `enable_thinking: false`) are vendor-API shapes, and this gateway's passthrough rejects them:
 * driven 2026-09-15, `thinking: {type: "disabled"}` made every Finance call on
 * `deepseek-v4-flash` and `deepseek-v4-pro` fail with HTTP 400 in 2-4 s, parse included, while
 * `reasoning_effort: "low"` alone returned 200. `reasoning_effort` is proven: Chat already sends
 * it to every one of these ids on every turn. Do not add a non-OpenAI field here without a live
 * 200 from this gateway to point at.
 */

/**
 * Chat-completions body extras for one job run, or null when nothing should change.
 *
 * Jobs are not Chat: Finance computes every metric in code, Documents and Presentations fill a
 * structure the host already fixed, and all of them ask for strict JSON. The model only writes the
 * narrative, so paying for a hidden reasoning pass buys nothing and costs a minute of silence that
 * the stream watchdog cannot see. Chat passes no mode and is never touched.
 */
export function jobThinkingExtras(modelId: string, mode: JobMode | undefined): Record<string, unknown> | null {
  if (!mode) {
    return null;
  }
  const knob = modelPolicy(modelId).jobThinking;
  return knob ? { ...knob } : null;
}

/**
 * The job knob split into the Thinking level it asks for and any other body fields. The runtime feeds
 * the level to its effort plan, so a level the gateway refuses can be stepped down and stay down,
 * instead of the knob writing it back over the plan on every request.
 */
export function jobThinkingPlan(
  modelId: string,
  mode: JobMode | undefined,
): { effort: ReasoningEffort | undefined; rest: Record<string, unknown> } | null {
  const extras = jobThinkingExtras(modelId, mode);
  if (!extras) {
    return null;
  }
  const { reasoning_effort: level, ...rest } = extras;
  return { effort: typeof level === "string" && isReasoningEffort(level) ? level : undefined, rest };
}

/** Merge the knob into a chat-completions body; it wins over the generic `reasoning_effort`. */
export function applyJobThinking(body: unknown, modelId: string, mode: JobMode | undefined): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body;
  }
  const extras = jobThinkingExtras(modelId, mode);
  if (!extras) {
    return body;
  }
  return { ...(body as Record<string, unknown>), ...extras };
}
