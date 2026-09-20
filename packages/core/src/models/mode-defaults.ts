import {
  firstLiveId,
  pickPreferredEmbeddingModel,
  pickPreferredImageModel,
  pickPreferredMusicModel,
  pickPreferredVideoModel,
} from "./media-kind";

export type JobMode = "documents" | "research" | "presentations" | "finance" | "data" | "market" | "legal";

export type ModeModelDefaults = {
  chat: string;
  documents: string;
  research: string;
  presentations: string;
  finance: string;
  data: string;
  market: string;
  legal: string;
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
 * The id every job mode falls back to on this gateway. The `hy3` / `hunyuan-3` first choices
 * below are **not** in the TokenKu catalog (170 ids, checked 2026-09-13 in
 * docs/internal/gateway-model-selection.md), so Documents, Finance, and Market all resolve to
 * this one today. It thinks by default, which is why jobs send it a thinking-off knob
 * (`packages/core/src/models/job-thinking.ts`) and the stream watchdog gives it the reasoning
 * budgets. Read this before reordering anything below.
 */
export const EFFECTIVE_JOB_MODEL = "deepseek-v4-flash";

/**
 * Ranked hints against the live chat catalog — not a closed allowlist.
 *
 * This list decides which model a mode gets on a healthy gateway, so reordering a head moves every
 * desk’s default. What to do when that first choice is unreachable is a separate ranking, in
 * `job-fallback.ts`: it appends `JOB_FALLBACK_TAIL` to whatever stands here, so a mode survives an
 * outage without its default being re-picked for it.
 */
export const JOB_MODE_PREFERENCES: Record<JobMode, string[]> = {
  documents: ["hy3", "hy-3", "hunyuan-3", "hunyuan3", "deepseek-v4-flash"],
  research: ["gpt-5.6-luna", "MiniMax-M3", "minimax-m3", "gpt-5.6-terra"],
  presentations: [
    "glm-5.3-flash",
    "glm-5.3-flash-preview",
    "glm-5.2-fast-preview",
    "glm-5.2",
    "glm-5.3",
    "kimi-k3",
  ],
  finance: ["hy3", "hy-3", "hunyuan-3", "deepseek-v4-flash"],
  data: ["gpt-5.6-luna", "MiniMax-M3", "minimax-m3", "gpt-5.6-terra"],
  market: ["hy3", "hy-3", "hunyuan-3", "deepseek-v4-flash"],
  /** Long contracts and strict JSON: prefer the larger everyday models. */
  legal: ["gpt-5.6-sol", "gpt-5.6-luna", "kimi-k3", "deepseek-v4-flash"],
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
    legalVerifier: pickPreferredJobModel("research", input.chatIds, input.chatDefault),
    image: pickPreferredImageModel(input.imageIds),
    video: pickPreferredVideoModel(input.videoIds),
    music: pickPreferredMusicModel(input.musicIds ?? []),
    embedding: pickPreferredEmbeddingModel(input.embeddingIds ?? []),
    knowledgeBrain: input.chatDefault,
    knowledgeVerifier: pickPreferredJobModel("research", input.chatIds, input.chatDefault),
  };
}
