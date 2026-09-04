import {
  firstLiveId,
  pickPreferredEmbeddingModel,
  pickPreferredImageModel,
  pickPreferredVideoModel,
} from "./media-kind";

export type JobMode = "documents" | "research" | "presentations" | "finance" | "data";

export type ModeModelDefaults = {
  chat: string;
  documents: string;
  research: string;
  presentations: string;
  finance: string;
  data: string;
  image: string;
  video: string;
  embedding: string;
  knowledgeBrain: string;
  knowledgeVerifier: string;
};

/** Ranked hints against the live chat catalog — not a closed allowlist. */
export const JOB_MODE_PREFERENCES: Record<JobMode, string[]> = {
  documents: ["hy3", "hy-3", "hunyuan-3", "hunyuan3", "deepseek-v4-flash"],
  research: ["gpt-5.6-luna", "MiniMax-M3", "minimax-m3"],
  presentations: [
    "glm-5.3-flash",
    "glm-5.3-flash-preview",
    "glm-5.2-fast-preview",
    "glm-5.2",
    "glm-5.3",
    "kimi-k3",
  ],
  finance: ["hy3", "hy-3", "hunyuan-3", "deepseek-v4-flash"],
  data: ["gpt-5.6-luna", "MiniMax-M3", "minimax-m3"],
};

export function pickPreferredJobModel(mode: JobMode, chatIds: string[], fallback: string): string {
  return firstLiveId(JOB_MODE_PREFERENCES[mode], chatIds) ?? fallback;
}

export function resolveModeDefaults(input: {
  chatIds: string[];
  imageIds: string[];
  videoIds: string[];
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
    image: pickPreferredImageModel(input.imageIds),
    video: pickPreferredVideoModel(input.videoIds),
    embedding: pickPreferredEmbeddingModel(input.embeddingIds ?? []),
    knowledgeBrain: input.chatDefault,
    knowledgeVerifier: pickPreferredJobModel("research", input.chatIds, input.chatDefault),
  };
}
