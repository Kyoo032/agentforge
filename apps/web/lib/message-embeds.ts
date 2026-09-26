import { safeLinkHref } from "./safe-link";

/**
 * How a Chat turn turns a bare link, an attached text file, or a tool payload
 * into a card. Inline links inside a sentence stay inline; only a paragraph
 * that is nothing but a link is a card.
 */

export type StandaloneKind = "link" | "file" | "job";

export type StandaloneLink = {
  kind: StandaloneKind;
  title: string;
  detail: string;
  href: string;
};

export type UserTextSegment = { type: "text"; text: string } | { type: "file"; name: string; body: string };

export type JobEmbedModel = {
  title: string;
  detail: string;
  href?: string;
};

const FILE_HEADER = /^---\s+(.+?)\s+---$/;
const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|csv|md|png|jpe?g|gif|webp|zip|rtf|odt|epub)(?:$|[?#])/i;
const JOB_SEGMENT =
  /\/(documents|research|finance|data|market|legal|meeting|images|videos|music|edit|presentations|artifacts)(?:\/|$)/i;

function clip(text: string, max = 160): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function hostnameOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pathOf(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

export function classifyStandaloneHref(href: string): StandaloneKind {
  const path = pathOf(href);
  if (FILE_EXT.test(path) || FILE_EXT.test(href)) {
    return "file";
  }
  if (JOB_SEGMENT.test(path) || JOB_SEGMENT.test(href)) {
    return "job";
  }
  return "link";
}

function fileTitle(href: string, label: string): string {
  try {
    const url = new URL(href);
    const base = url.pathname.split("/").filter(Boolean).pop();
    if (base && (label === href || label === url.href || label === "")) {
      return decodeURIComponent(base);
    }
  } catch {
    // The label is already the readable name.
  }
  return label || href;
}

/** A safe http(s) link that can stand as its own card. Unsafe schemes return null. */
export function presentStandaloneLink(href: string, label: string): StandaloneLink | null {
  const safe = safeLinkHref(href);
  if (!safe) {
    return null;
  }
  const kind = classifyStandaloneHref(safe);
  const host = hostnameOf(safe);
  const text = label.trim();
  const raw = text === "" || text === href || text === safe;
  if (kind === "file") {
    return { kind, title: fileTitle(safe, text), detail: host, href: safe };
  }
  if (kind === "job") {
    return { kind, title: raw ? host || safe : text, detail: host, href: safe };
  }
  if (raw) {
    const path = pathOf(safe);
    return {
      kind,
      title: host || safe,
      detail: path && path !== "/" ? `${host}${path}` : host,
      href: safe,
    };
  }
  return { kind, title: text, detail: host, href: safe };
}

/**
 * Text files the composer inlines as `--- name ---` followed by the body.
 * A header has to be its own line, which is how the composer writes it.
 */
export function splitUserFileBlocks(text: string): UserTextSegment[] {
  const lines = text.split("\n");
  const segments: UserTextSegment[] = [];
  const textLines: string[] = [];
  const flush = () => {
    const joined = textLines.join("\n").trim();
    textLines.length = 0;
    if (joined) {
      segments.push({ type: "text", text: joined });
    }
  };
  let index = 0;
  while (index < lines.length) {
    const header = FILE_HEADER.exec(lines[index] ?? "");
    const name = header?.[1]?.trim() ?? "";
    if (header && name) {
      flush();
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !FILE_HEADER.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      segments.push({ type: "file", name, body: body.join("\n").trim() });
      continue;
    }
    textLines.push(lines[index] ?? "");
    index += 1;
  }
  flush();
  if (segments.length === 0) {
    return [{ type: "text", text }];
  }
  return segments;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function hitFrom(item: unknown): JobEmbedModel | null {
  const record = asRecord(item);
  if (!record) {
    return null;
  }
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const url = typeof record.url === "string" ? record.url.trim() : "";
  const detailSource = [record.description, record.snippet, record.summary].find((value) => typeof value === "string");
  const detail = typeof detailSource === "string" ? clip(detailSource) : "";
  if (!title && !url) {
    return null;
  }
  const href = url ? (safeLinkHref(url) ?? undefined) : undefined;
  return { title: title || href || url, detail, href };
}

function hitLists(record: Record<string, unknown>): unknown[][] {
  const lists: unknown[][] = [];
  const consider = (value: unknown) => {
    if (Array.isArray(value) && value.some((item) => hitFrom(item))) {
      lists.push(value);
    }
  };
  consider(record.results);
  consider(record.hits);
  consider(record.web);
  const data = asRecord(record.data);
  if (data) {
    consider(data.web);
    consider(data.results);
    consider(data.hits);
  }
  return lists;
}

function singleJob(record: Record<string, unknown>): JobEmbedModel | null {
  if (typeof record.title !== "string" || !record.title.trim()) {
    return null;
  }
  const detailSource = [record.summary, record.description, record.text].find((value) => typeof value === "string");
  if (typeof detailSource !== "string" || !detailSource.trim()) {
    return null;
  }
  const href = typeof record.url === "string" ? (safeLinkHref(record.url) ?? undefined) : undefined;
  return { title: record.title.trim(), detail: clip(detailSource), href };
}

/** Search hits and titled results a tool handed back. A bare number is not a card. */
export function jobEmbedsFromOutput(output: unknown): JobEmbedModel[] {
  const record = asRecord(output);
  if (!record) {
    return [];
  }
  const hits: JobEmbedModel[] = [];
  for (const list of hitLists(record)) {
    for (const item of list) {
      const hit = hitFrom(item);
      if (hit) {
        hits.push(hit);
      }
      if (hits.length >= 3) {
        return hits;
      }
    }
  }
  if (hits.length > 0) {
    return hits;
  }
  const data = asRecord(record.data);
  const single = singleJob(record) ?? (data ? singleJob(data) : null);
  return single ? [single] : [];
}

export function jobEmbedsFromTools(tools: Array<{ status: string; output?: unknown }>): JobEmbedModel[] {
  const cards: JobEmbedModel[] = [];
  for (const tool of tools) {
    if (tool.status !== "completed") {
      continue;
    }
    for (const card of jobEmbedsFromOutput(tool.output)) {
      cards.push(card);
      if (cards.length >= 3) {
        return cards;
      }
    }
  }
  return cards;
}
