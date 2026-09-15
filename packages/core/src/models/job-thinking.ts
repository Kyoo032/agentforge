import type { JobMode } from "./mode-defaults";
import { bareModelId } from "./request-constraints";

/**
 * Least-thinking knob per gateway family, for the families `QUIET_REASONING_FAMILY` in
 * `packages/core/src/runtime/stream-watchdog.ts` waits longer for: they think before they answer
 * and stream that thinking as `reasoning_content`, which AI SDK 4 drops. Keep the two lists
 * together — `job-thinking.test.ts` fails if they drift.
 *
 * Only `reasoning_effort` is ever sent. The vendor knobs in section 3 of
 * docs/internal/gateway-model-selection.md (DeepSeek `thinking: {type: "disabled"}`, Qwen
 * `enable_thinking: false`) are vendor-API shapes, and this gateway's passthrough rejects them:
 * driven 2026-09-15, `thinking: {type: "disabled"}` made every Finance call on
 * `deepseek-v4-flash` and `deepseek-v4-pro` fail with HTTP 400 in 2-4 s, parse included, while
 * `reasoning_effort: "low"` alone returned 200. `reasoning_effort` is proven: Chat already sends
 * it to every one of these ids on every turn. Do not add a non-OpenAI field here without a live
 * 200 from this gateway to point at.
 */
const QUIET_THINKING_KNOBS: ReadonlyArray<{ match: RegExp; extras: () => Record<string, unknown> }> = [
  // DeepSeek V4: thinks at high by default; its `thinking: {type: "disabled"}` is a 400 here (2026-09-15).
  { match: /^deepseek-v4/, extras: () => ({ reasoning_effort: "low" }) },
  // GLM-5.3 / 5.3-flash: `reasoning_effort` low...high, cannot be turned off. Driven 200 at low.
  { match: /^glm-5\.3/, extras: () => ({ reasoning_effort: "low" }) },
  // Kimi K3: `reasoning_effort`, cannot be turned off.
  { match: /^kimi-k3/, extras: () => ({ reasoning_effort: "low" }) },
  // Qwen3.8-Max: thinks by default; `enable_thinking: false` is a vendor field this gateway has
  // never been seen to accept, so it gets the proven effort knob like the rest.
  { match: /^qwen3\.8-max/, extras: () => ({ reasoning_effort: "low" }) },
];

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
  const id = bareModelId(modelId);
  const knob = QUIET_THINKING_KNOBS.find((entry) => entry.match.test(id));
  return knob ? knob.extras() : null;
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
