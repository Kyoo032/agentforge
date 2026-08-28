export function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part) => part && typeof part === "object" && "text" in part)
    .map((part) => String((part as { text: string }).text))
    .join("\n")
    .trim();
}
