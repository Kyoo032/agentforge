/** OR of the first meaningful words, each quoted as an FTS5 string so keywords and operators are literal. */
export function knowledgeFtsQuery(query: string): string {
  return query
    .trim()
    .replace(/['"]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 8)
    .map((word) => `"${word}"`)
    .join(" OR ");
}

export function chunkKnowledgeText(text: string, size = 800): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) {
    return [];
  }
  const chunks: string[] = [];
  for (let i = 0; i < cleaned.length; i += size) {
    chunks.push(cleaned.slice(i, i + size));
  }
  return chunks;
}
