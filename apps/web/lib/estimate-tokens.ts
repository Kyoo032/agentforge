/** Rough chat-token estimate: ~4 characters per token. Not a tokenizer. */
export function estimateTokensFromText(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return Math.ceil(trimmed.length / 4);
}

export function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const chunks: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const type = (part as { type?: unknown }).type;
    if (type === "text" || type === "thinking") {
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) {
        chunks.push(text);
      }
    }
  }
  return chunks.join("\n");
}

export function estimateConversationTokens(
  messages: Array<{ content?: unknown }>,
  extra: string[] = [],
): number {
  let used = 0;
  for (const message of messages) {
    used += estimateTokensFromText(textFromMessageContent(message.content));
  }
  for (const chunk of extra) {
    used += estimateTokensFromText(chunk);
  }
  return used;
}
