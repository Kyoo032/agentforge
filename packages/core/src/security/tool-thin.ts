const DESCRIPTION_CAP = 280;
const DATA_URL_RE = /data:[^;\s]+;base64,[A-Za-z0-9+/=\s]{80,}/gi;
const LONG_B64_RE = /[A-Za-z0-9+/]{400,}={0,2}/g;

function looksLikeError(output: unknown): boolean {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return false;
  }
  const record = output as Record<string, unknown>;
  if (record.success === false) {
    return true;
  }
  if (typeof record.error === "string" && record.error.length > 0) {
    return true;
  }
  return false;
}

function stripStringBlobs(text: string): string {
  return text.replace(DATA_URL_RE, "[omitted data url]").replace(LONG_B64_RE, "[omitted binary]");
}

function stripBlobs(value: unknown): unknown {
  if (typeof value === "string") {
    return stripStringBlobs(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = stripBlobs(value[i]);
    }
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      record[key] = stripBlobs(record[key]);
    }
  }
  return value;
}

function isSearchHit(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.title === "string" && typeof record.url === "string" && "description" in record;
}

function thinSearchHit(hit: Record<string, unknown>): { title: string; url: string; description: string } {
  const description = typeof hit.description === "string" ? hit.description : "";
  return {
    title: hit.title as string,
    url: hit.url as string,
    description: description.length > DESCRIPTION_CAP ? `${description.slice(0, DESCRIPTION_CAP)}…` : description,
  };
}

function thinWebSearch(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      value[i] = isSearchHit(item) ? thinSearchHit(item) : thinWebSearch(item);
    }
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      record[key] = isSearchHit(child) ? thinSearchHit(child) : thinWebSearch(child);
    }
  }
  return value;
}

/**
 * Shrink tool results before they go back to the model.
 * Full output is persisted separately. Errors are never thinned. Fail-open.
 */
const WEB_FETCH_CHAT_MAX_CHARS = 6_000;

/** Chat agents get a bounded page body; the research reader uses fetchPageText directly with its own cap. */
function thinWebFetch(output: unknown): void {
  const data = (output as { data?: { text?: unknown } } | null)?.data;
  if (data && typeof data.text === "string" && data.text.length > WEB_FETCH_CHAT_MAX_CHARS) {
    data.text = `${data.text.slice(0, WEB_FETCH_CHAT_MAX_CHARS)}\n[truncated]`;
  }
}

export function thinToolOutput(toolKey: string, output: unknown): unknown {
  try {
    if (looksLikeError(output)) {
      return output;
    }
    const cloned = JSON.parse(JSON.stringify(output)) as unknown;
    if (toolKey === "web_search") {
      thinWebSearch(cloned);
    }
    if (toolKey === "web_fetch") {
      thinWebFetch(cloned);
    }
    stripBlobs(cloned);
    return cloned;
  } catch {
    return output;
  }
}
