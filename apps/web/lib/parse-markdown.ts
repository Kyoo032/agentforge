import { isRenderableImageUrl } from "./renderable-media";

export type MdInline =
  | { type: "text"; value: string }
  | { type: "strong"; children: MdInline[] }
  | { type: "em"; children: MdInline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: MdInline[] }
  | { type: "image"; src: string; alt: string };

export type MdTableAlign = "left" | "center" | "right" | null;

export type MdBlock =
  | { type: "p"; children: MdInline[] }
  | { type: "h"; level: 1 | 2 | 3; children: MdInline[] }
  | { type: "ul"; items: MdInline[][] }
  | { type: "ol"; items: MdInline[][] }
  | { type: "pre"; value: string }
  | { type: "quote"; children: MdInline[] }
  | { type: "table"; header: MdInline[][]; align: MdTableAlign[]; rows: MdInline[][][] };

const UL = /^\s{0,3}[-*+]\s+(.*)$/;
const OL = /^\s{0,3}\d+\.\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,3})\s+(.+)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const FENCE = /^\s{0,3}```/;
const AUTOLINK = /^(https?:\/\/[^\s<>[\]()]+)/i;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const TRAILING_PIPE = /(^|[^\\])\|$/;

/** A GFM table starts on a line containing `|` whose next line is a delimiter row of the same width. */
const TABLE_START = (lines: readonly string[], index: number): boolean => {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  if (!line.includes("|") || !TABLE_DELIM.test(next)) {
    return false;
  }
  return splitTableCells(line).length === splitTableCells(next).length;
};

export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("//")) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("mailto:") || trimmed.startsWith("#")) {
    return trimmed;
  }
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }
  if (trimmed.startsWith("agentforge://media/")) {
    return trimmed;
  }
  return null;
}

/**
 * The src a rendered markdown image may carry. Host-served media and inline raster
 * data URLs only: a remote URL in model output must not auto-load, so `parseInline`
 * turns it into a link instead.
 */
export function safeImageSrc(src: string): string | null {
  const trimmed = src.trim();
  return isRenderableImageUrl(trimmed) ? trimmed : null;
}

export function parseInline(input: string): MdInline[] {
  const out: MdInline[] = [];
  let i = 0;
  let textStart = 0;

  function flush(end: number) {
    if (end > textStart) {
      out.push({ type: "text", value: input.slice(textStart, end) });
    }
  }

  while (i < input.length) {
    if (input[i] === "`") {
      const close = input.indexOf("`", i + 1);
      if (close > i + 1) {
        flush(i);
        out.push({ type: "code", value: input.slice(i + 1, close) });
        i = close + 1;
        textStart = i;
        continue;
      }
    }

    if (input.startsWith("![", i)) {
      const parsed = takeLinkLike(input, i + 1);
      if (parsed) {
        const image = imageNode(parsed);
        if (image) {
          flush(i);
          out.push(image);
          i = parsed.end;
          textStart = i;
          continue;
        }
      }
    }

    if (input[i] === "[") {
      const parsed = takeLinkLike(input, i);
      if (parsed) {
        const href = safeHref(parsed.href);
        if (href) {
          flush(i);
          out.push({ type: "link", href, children: parseInline(parsed.label) });
          i = parsed.end;
          textStart = i;
          continue;
        }
      }
    }

    if (input.startsWith("**", i) || input.startsWith("__", i)) {
      const mark = input.slice(i, i + 2);
      const close = input.indexOf(mark, i + 2);
      if (close > i + 2) {
        flush(i);
        out.push({ type: "strong", children: parseInline(input.slice(i + 2, close)) });
        i = close + 2;
        textStart = i;
        continue;
      }
    }

    if ((input[i] === "*" || input[i] === "_") && input[i + 1] !== input[i]) {
      const mark = input[i]!;
      const close = input.indexOf(mark, i + 1);
      if (close > i + 1 && (mark === "*" || !/\w/.test(input[i - 1] ?? "") || !/\w/.test(input[close + 1] ?? ""))) {
        flush(i);
        out.push({ type: "em", children: parseInline(input.slice(i + 1, close)) });
        i = close + 1;
        textStart = i;
        continue;
      }
    }

    const auto = input.slice(i).match(AUTOLINK);
    if (auto?.[1] && (i === 0 || /\s/.test(input[i - 1] ?? ""))) {
      flush(i);
      const raw = auto[1].replace(/[.,;:!?)]+$/, "");
      const href = safeHref(raw);
      if (href) {
        out.push({ type: "link", href, children: [{ type: "text", value: raw }] });
        i += raw.length;
        textStart = i;
        continue;
      }
    }

    i += 1;
  }

  flush(input.length);
  return out;
}

/**
 * An `![alt](src)` becomes an image only for a src the renderer may auto-load.
 * A src it may not — a remote http(s) URL from a model — degrades to a link the
 * reader has to click, so nothing is fetched on render. Anything else is null and
 * the source text is kept verbatim.
 */
function imageNode(parsed: { label: string; href: string }): MdInline | null {
  const src = safeImageSrc(parsed.href);
  if (src) {
    return { type: "image", src, alt: parsed.label };
  }
  const href = safeHref(parsed.href);
  if (!href) {
    return null;
  }
  return { type: "link", href, children: [{ type: "text", value: parsed.label || href }] };
}

function takeLinkLike(input: string, start: number): { label: string; href: string; end: number } | null {
  if (input[start] !== "[") {
    return null;
  }
  const labelEnd = input.indexOf("]", start + 1);
  if (labelEnd < 0 || input[labelEnd + 1] !== "(") {
    return null;
  }
  const hrefEnd = input.indexOf(")", labelEnd + 2);
  if (hrefEnd < 0) {
    return null;
  }
  return {
    label: input.slice(start + 1, labelEnd),
    href: input.slice(labelEnd + 2, hrefEnd),
    end: hrefEnd + 1,
  };
}

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push({ type: "pre", value: body.join("\n") });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ type: "h", level, children: parseInline(heading[2]!.trim()) });
      i += 1;
      continue;
    }

    if (UL.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const item = (lines[i] ?? "").match(UL);
        if (!item) {
          break;
        }
        items.push(parseInline(item[1] ?? ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (OL.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length) {
        const item = (lines[i] ?? "").match(OL);
        if (!item) {
          break;
        }
        items.push(parseInline(item[1] ?? ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length) {
        const item = (lines[i] ?? "").match(QUOTE);
        if (!item) {
          break;
        }
        quoted.push(item[1] ?? "");
        i += 1;
      }
      blocks.push({ type: "quote", children: parseInline(quoted.join(" ")) });
      continue;
    }

    if (TABLE_START(lines, i)) {
      const table = parseTable(lines, i);
      blocks.push(table.block);
      i = table.end;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (
        !next.trim() ||
        UL.test(next) ||
        OL.test(next) ||
        HEADING.test(next) ||
        FENCE.test(next) ||
        QUOTE.test(next)
      ) {
        break;
      }
      if (TABLE_START(lines, i)) {
        break;
      }
      para.push(next);
      i += 1;
    }
    blocks.push({ type: "p", children: parseInline(para.join("\n")) });
  }

  return blocks;
}

function parseTable(lines: readonly string[], start: number): { block: MdBlock; end: number } {
  const header = splitTableCells(lines[start] ?? "").map(parseInline);
  const width = header.length;
  const align = fitRow(splitTableCells(lines[start + 1] ?? ""), width).map(parseAlign);
  const rows: MdInline[][][] = [];
  let i = start + 2;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || !line.includes("|")) {
      break;
    }
    rows.push(fitRow(splitTableCells(line), width).map(parseInline));
    i += 1;
  }
  return { block: { type: "table", header, align, rows }, end: i };
}

/** Split a table row on unescaped `|`, honouring `\|` as a literal pipe, and drop the outer-pipe empties. */
function splitTableCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i] ?? "";
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 2;
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
    i += 1;
  }
  cells.push(current.trim());
  return stripOuterCells(cells, line.trim());
}

function stripOuterCells(cells: readonly string[], trimmedLine: string): string[] {
  const start = trimmedLine.startsWith("|") ? 1 : 0;
  const end = TRAILING_PIPE.test(trimmedLine) && cells.length > start ? cells.length - 1 : cells.length;
  return cells.slice(start, end);
}

function fitRow(cells: readonly string[], width: number): string[] {
  return Array.from({ length: width }, (_, index) => cells[index] ?? "");
}

function parseAlign(cell: string): MdTableAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (left) {
    return "left";
  }
  return right ? "right" : null;
}

export function markdownPlainText(text: string): string {
  return flatten(parseMarkdown(text)).join(" ").replace(/\s+/g, " ").trim();
}

function flatten(blocks: MdBlock[]): string[] {
  return blocks.flatMap((block) => {
    if (block.type === "pre") {
      return [block.value];
    }
    if (block.type === "ul" || block.type === "ol") {
      return block.items.map((item) => inlineText(item));
    }
    if (block.type === "table") {
      return [block.header, ...block.rows].map((row) => row.map(inlineText).join(" "));
    }
    return [inlineText(block.children)];
  });
}

function inlineText(nodes: MdInline[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "code") {
        return node.value;
      }
      if (node.type === "image") {
        return node.alt;
      }
      return inlineText(node.children);
    })
    .join("");
}
