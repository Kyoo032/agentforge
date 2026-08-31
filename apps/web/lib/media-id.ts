export function mediaIdFromUrl(url: string): string | null {
  const match = url.match(/^\/api\/v1\/media\/([0-9a-f-]{36})\/file$/i);
  return match?.[1] ?? null;
}
