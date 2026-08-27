import { ApiError } from "../errors";
import type { InputModality } from "../tenancy/types";

export type ModelModalities = {
  text: true;
  image: boolean;
  video: boolean;
};

const DEFAULT: ModelModalities = { text: true, image: false, video: false };

const BY_PREFIX: Array<{ prefix: string; caps: ModelModalities }> = [
  { prefix: "default", caps: { text: true, image: true, video: true } },
  { prefix: "deepseek", caps: { text: true, image: true, video: false } },
  { prefix: "kimi", caps: { text: true, image: true, video: false } },
  { prefix: "glm", caps: { text: true, image: true, video: false } },
  { prefix: "gemini", caps: { text: true, image: true, video: true } },
  { prefix: "gemma", caps: { text: true, image: true, video: false } },
  { prefix: "doubao-seedance", caps: { text: true, image: true, video: true } },
  { prefix: "doubao", caps: { text: true, image: true, video: true } },
  { prefix: "seedance", caps: { text: true, image: true, video: true } },
  { prefix: "gpt-5", caps: { text: true, image: true, video: false } },
  { prefix: "gpt-4o", caps: { text: true, image: true, video: false } },
  { prefix: "gpt-4.1", caps: { text: true, image: true, video: false } },
  { prefix: "gpt-4", caps: { text: true, image: true, video: false } },
  { prefix: "claude", caps: { text: true, image: true, video: false } },
  { prefix: "o4", caps: { text: true, image: true, video: false } },
  { prefix: "o3", caps: { text: true, image: true, video: false } },
  { prefix: "o1", caps: { text: true, image: false, video: false } },
  { prefix: "ep-", caps: { text: true, image: true, video: false } },
];

export function getModelModalities(model: string): ModelModalities {
  const match = BY_PREFIX.find((entry) => model.toLowerCase().startsWith(entry.prefix));
  return match?.caps ?? DEFAULT;
}

export function assertModelSupportsModality(model: string, modality: InputModality): void {
  if (modality === "text") {
    return;
  }
  const caps = getModelModalities(model);
  if (!caps[modality]) {
    throw new ApiError(
      "model_missing_modality",
      `Model '${model}' does not support ${modality} input`,
      400,
    );
  }
}

export function assertAgentSupportsModality(inputModalities: InputModality[], modality: InputModality): void {
  if (!inputModalities.includes(modality)) {
    throw new ApiError(
      "modality_not_enabled",
      `This agent does not accept ${modality} input`,
      400,
    );
  }
}

export const RUN_PATHS = {
  text: "/api/v1/threads/{threadId}/runs/text",
  image: "/api/v1/threads/{threadId}/runs/image",
  video: "/api/v1/threads/{threadId}/runs/video",
} as const;
