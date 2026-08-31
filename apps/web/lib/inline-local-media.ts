import {
  DEFAULT_OPENAI_BASE_URL,
  isLoopbackHost,
  localMediaId,
  type ContentPart,
  type TenantContext,
} from "@agentforge/core";

/** Local files can be inlined for Ollama; a remote gateway cannot fetch loopback and may reject data URLs. */
export function shouldInlineLocalMediaForProvider(baseUrl?: string): boolean {
  const raw = (baseUrl || DEFAULT_OPENAI_BASE_URL).trim();
  try {
    return isLoopbackHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export async function inlineLocalMediaParts(
  tenant: TenantContext,
  parts: ContentPart[],
): Promise<ContentPart[]> {
  const next: ContentPart[] = [];
  for (const part of parts) {
    if (part.type !== "image_url") {
      next.push(part);
      continue;
    }
    const id = localMediaId(part.image_url.url);
    if (!id) {
      next.push(part);
      continue;
    }
    const { readMediaDataUrl } = await import("./media");
    const dataUrl = await readMediaDataUrl(tenant, id);
    next.push(
      dataUrl
        ? { type: "image_url", image_url: { ...part.image_url, url: dataUrl } }
        : part,
    );
  }
  return next;
}
