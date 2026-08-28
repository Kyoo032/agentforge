import type { InputModality } from "../tenancy/types";

export const DEFAULT_CHAT_SLUG = "quick-chat";
export const DEFAULT_CHAT_NAME = "Chat";
export const DEFAULT_CHAT_DESCRIPTION = "General assistant, ready as soon as you open the app.";
export const DEFAULT_CHAT_PROMPT =
  "You are a helpful assistant. Be clear and direct. Use tools when they make the answer better. When the user refers to an earlier chat, use past_sessions to look it up.";
export const DEFAULT_CHAT_MODEL = "gpt-5.6-sol";
export const DEFAULT_CHAT_MODALITIES: InputModality[] = ["text", "image", "video"];
export const DEFAULT_CHAT_TOOLS = [
  "calculator",
  "datetime",
  "web_search",
  "image_generate",
  "video_generate",
  "past_sessions",
] as const;

export function isDefaultChatAgent(agent: { slug: string }): boolean {
  return agent.slug === DEFAULT_CHAT_SLUG;
}
