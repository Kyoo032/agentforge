import type { ContentPart, TextPart, ThinkingPart, ToolCallPart } from "./types";

export type { ContentPart, TextPart, ImageUrlPart, VideoUrlPart, ThinkingPart, ToolCallPart } from "./types";

export function isTextPart(part: ContentPart): part is TextPart {
  return part.type === "text";
}

export function isThinkingPart(part: ContentPart): part is ThinkingPart {
  return part.type === "thinking";
}

export function isToolCallPart(part: ContentPart): part is ToolCallPart {
  return part.type === "tool_call";
}

/** Visible answer only — never thinking or tool traces. */
export function visibleAnswerText(parts: ContentPart[]): string {
  return parts
    .filter(isTextPart)
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function thinkingTextFromParts(parts: ContentPart[]): string {
  return parts
    .filter(isThinkingPart)
    .map((part) => part.text)
    .join("")
    .trim();
}

export function toolCallsFromParts(parts: ContentPart[]): ToolCallPart[] {
  return parts.filter(isToolCallPart);
}

/** History sent to the model: user/assistant text and media only. */
export function modelHistoryParts(parts: ContentPart[]): ContentPart[] {
  return parts.filter(
    (part) => part.type === "text" || part.type === "image_url" || part.type === "video_url",
  );
}

export function hasModelVisibleContent(parts: ContentPart[]): boolean {
  return modelHistoryParts(parts).some((part) => {
    if (part.type === "text") {
      return part.text.trim().length > 0;
    }
    return true;
  });
}
