import { firstLiveId, pickPreferredImageModel, pickPreferredVideoModel } from "./media-kind";

export type JobMode = "documents" | "research" | "presentations";

export type ModeModelDefaults = {
  chat: string;
  documents: string;
  research: string;
  presentations: string;
  image: string;
  video: string;
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
};

export function pickPreferredJobModel(mode: JobMode, chatIds: string[], fallback: string): string {
  return firstLiveId(JOB_MODE_PREFERENCES[mode], chatIds) ?? fallback;
}

export function resolveModeDefaults(input: {
  chatIds: string[];
  imageIds: string[];
  videoIds: string[];
  chatDefault: string;
}): ModeModelDefaults {
  return {
    chat: input.chatDefault,
    documents: pickPreferredJobModel("documents", input.chatIds, input.chatDefault),
    research: pickPreferredJobModel("research", input.chatIds, input.chatDefault),
    presentations: pickPreferredJobModel("presentations", input.chatIds, input.chatDefault),
    image: pickPreferredImageModel(input.imageIds),
    video: pickPreferredVideoModel(input.videoIds),
  };
}
