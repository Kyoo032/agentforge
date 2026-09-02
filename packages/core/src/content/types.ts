export type TextPart = {
  type: "text";
  text: string;
};

export type ImageUrlPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
};

export type VideoUrlPart = {
  type: "video_url";
  video_url: {
    url: string;
  };
};

/** Assistant-only: chain-of-thought. Never accepted on user run input. */
export type ThinkingPart = {
  type: "thinking";
  text: string;
};

/** Assistant-only: a tool call in the transcript. Never accepted on user run input. */
export type ToolCallPart = {
  type: "tool_call";
  toolKey: string;
  status: "started" | "completed";
  input?: unknown;
  output?: unknown;
};

export type ContentPart = TextPart | ImageUrlPart | VideoUrlPart | ThinkingPart | ToolCallPart;

export type RunInputBody = {
  content?: unknown;
  stream?: unknown;
};
