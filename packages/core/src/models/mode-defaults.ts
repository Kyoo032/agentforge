import { pickPreferredImageModel, pickPreferredVideoModel } from "./media-kind";

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
  documents: [
    "claude-sonnet-5",
    "claude-opus-5",
    "kimi-k3",
    "glm-5.3",
    "gpt-5.6-sol",
    "gpt-5.5",
    "gpt-5",
  ],
  research: ["deepseek-v4-pro", "gpt-5.6-sol", "claude-sonnet-5", "kimi-k3", "glm-5.3"],
  presentations: ["gpt-5.6-sol", "claude-sonnet-5", "glm-5.3", "gemini-3.5-flash", "kimi-k3"],
};

export function pickPreferredJobModel(mode: JobMode, chatIds: string[], fallback: string): string {
  const available = new Set(chatIds);
  return JOB_MODE_PREFERENCES[mode].find((id) => available.has(id)) ?? fallback;
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
