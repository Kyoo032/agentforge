import {
  firstLiveId,
  pickPreferredEmbeddingModel,
  pickPreferredImageModel,
  pickPreferredMusicModel,
  pickPreferredVideoModel,
} from "./media-kind";

export type JobMode =
  | "documents"
  | "research"
  | "presentations"
  | "finance"
  | "data"
  | "market"
  | "legal"
  | "meeting";

export type ModeModelDefaults = {
  chat: string;
  documents: string;
  research: string;
  presentations: string;
  finance: string;
  data: string;
  market: string;
  legal: string;
  meeting: string;
  /** Second model for the Legal verify pass: checklist grading and the opposing-counsel review. */
  legalVerifier: string;
  image: string;
  video: string;
  music: string;
  embedding: string;
  knowledgeBrain: string;
  knowledgeVerifier: string;
};

/**
 * The id the Documents, Finance and Market jobs resolve to on this gateway. `hy3` is listed and was
 * probed live on 2026-09-30 (reasoning_effort none, low, medium and high all answered, first token 2 to
 * 3 s), so it heads those three lists and the DeepSeek V4.1 and V4 Flash ids stand behind it. Nothing
 * reads this constant: the preference lists below are what deliver a model, and `job-fallback.ts` is
 * what replaces it in an outage. The DeepSeek ids still think by default, which is why jobs send them a
 * quiet-thinking knob (`packages/core/src/models/job-thinking.ts`) and the stream watchdog gives them
 * the reasoning budgets. Read this and docs/internal/gateway-model-selection.md (2026-09-30) before
 * reordering anything below.
 */
export const EFFECTIVE_JOB_MODEL = "hy3";

/**
 * Ranked hints against the live chat catalog — not a closed allowlist.
 *
 * This list decides which model a mode gets on a healthy gateway, so reordering a head moves every
 * desk’s default. What to do when that first choice is unreachable is a separate ranking, in
 * `job-fallback.ts`: it appends `JOB_FALLBACK_TAIL` to whatever stands here, so a mode survives an
 * outage without its default being re-picked for it.
 *
 * Reordered on 2026-09-30 for the gateway's new models (prices from /api/pricing, latency from the
 * same day's probe; docs/internal/gateway-model-selection.md). Every id named here has an entry of its
 * own in `MODEL_POLICY_TABLE` or a family entry with a verified note, and `model-policy-guard.test.ts`
 * fails if one does not.
 */
export const JOB_MODE_PREFERENCES: Record<JobMode, string[]> = {
  documents: ["hy3", "deepseek-v4-1-flash", "deepseek-v4-flash"],
  /** GPT 6 Luna ($0.10 / $0.50 per 1M) first, then Sol; MiniMax keeps both spellings the gateway has used. */
  research: ["gpt-6-luna", "gpt-6-sol", "gpt-5.6-luna", "MiniMax-M3", "minimax-m3"],
  /** GLM 5.3 Flash made the demo decks on 2026-09-30 (111 s), at $0.075 / $0.25 per 1M. */
  presentations: ["glm-5.3-flash", "claude-sonnet-5-5", "glm-5.3", "kimi-k3"],
  finance: ["hy3", "deepseek-v4-1-flash", "deepseek-v4-flash"],
  data: ["gpt-6-luna", "gpt-6-sol", "gpt-5.6-luna", "MiniMax-M3", "minimax-m3"],
  market: ["hy3", "deepseek-v4-1-flash", "deepseek-v4-flash"],
  /** Long contracts and strict JSON: prefer the larger everyday models. */
  legal: ["gpt-6-sol", "claude-sonnet-5-5", "gpt-5.6-sol", "kimi-k3"],
  /**
   * Minutes are schema-bound JSON read off a transcript that can run to tens of thousands of
   * tokens, so the heads are the ids that rank for both strict output (§1.4) and long input
   * (§1.6) in docs/internal/gateway-model-selection.md. The same model writes the translation.
   * GPT 6 Sol ($2 / $10 per 1M) replaces GPT 5.6 Sol ($4 / $20) at the head; not driven on a real
   * minutes job, only probed.
   */
  meeting: ["gpt-6-sol", "claude-sonnet-5-5", "gemini-3.5-flash", "gpt-5.6-sol"],
};

export function pickPreferredJobModel(mode: JobMode, chatIds: string[], fallback: string): string {
  return firstLiveId(JOB_MODE_PREFERENCES[mode], chatIds) ?? fallback;
}

export function resolveModeDefaults(input: {
  chatIds: string[];
  imageIds: string[];
  videoIds: string[];
  musicIds?: string[];
  embeddingIds?: string[];
  chatDefault: string;
}): ModeModelDefaults {
  return {
    chat: input.chatDefault,
    documents: pickPreferredJobModel("documents", input.chatIds, input.chatDefault),
    research: pickPreferredJobModel("research", input.chatIds, input.chatDefault),
    presentations: pickPreferredJobModel("presentations", input.chatIds, input.chatDefault),
    finance: pickPreferredJobModel("finance", input.chatIds, input.chatDefault),
    data: pickPreferredJobModel("data", input.chatIds, input.chatDefault),
    market: pickPreferredJobModel("market", input.chatIds, input.chatDefault),
    legal: pickPreferredJobModel("legal", input.chatIds, input.chatDefault),
    meeting: pickPreferredJobModel("meeting", input.chatIds, input.chatDefault),
    legalVerifier: pickPreferredJobModel("research", input.chatIds, input.chatDefault),
    image: pickPreferredImageModel(input.imageIds),
    video: pickPreferredVideoModel(input.videoIds),
    music: pickPreferredMusicModel(input.musicIds ?? []),
    embedding: pickPreferredEmbeddingModel(input.embeddingIds ?? []),
    knowledgeBrain: input.chatDefault,
    knowledgeVerifier: pickPreferredJobModel("research", input.chatIds, input.chatDefault),
  };
}
