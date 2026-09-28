import type { OpenSlideBlock, OpenSlideDeck, OpenSlidePage, OpenSlidePageCount } from "./deck";

/**
 * Checks the deck after a draft. Length, source, and notes are repaired here.
 * A short deck is the only case that still needs another model call.
 */

export type OpenSlideSkillCopy = {
  note: string;
  noFigure: string;
};

export type OpenSlideLength = "kept" | "trimmed" | "short";

export type OpenSlideSkillReport = {
  length: OpenSlideLength;
  notesFilled: number;
  sourceRewrites: number;
  figuresCleared: number;
};

const BRACKET: Record<OpenSlidePageCount, { min: number; max: number }> = {
  short: { min: 3, max: 5 },
  standard: { min: 6, max: 10 },
  deep: { min: 11, max: 12 },
};

const BULLET_CAP: Record<OpenSlideDeck["brief"]["density"], number> = {
  minimal: 1,
  light: 3,
  standard: 5,
  dense: 5,
};

export function openSlidePageBracket(pageCount: OpenSlidePageCount): { min: number; max: number } {
  return BRACKET[pageCount];
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3);
}

function sentences(source: string): string[] {
  return source
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12)
    .slice(0, 24)
    .map((part) => (part.length > 180 ? `${part.slice(0, 179).trimEnd()}…` : part));
}

function supported(text: string, sourceNorm: string, sourceWords: Set<string>): boolean {
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm.length >= 12 && sourceNorm.includes(norm)) {
    return true;
  }
  const own = words(text);
  if (own.length === 0) {
    return true;
  }
  const hits = own.filter((word) => sourceWords.has(word)).length;
  return hits / own.length >= 0.6;
}

function trimPages(pages: OpenSlidePage[], max: number): OpenSlidePage[] {
  if (pages.length <= max) {
    return pages;
  }
  const last = pages[pages.length - 1];
  if (last?.role !== "closing" || max < 2) {
    return pages.slice(0, max);
  }
  const head = pages.slice(0, max - 1);
  if (head.some((page) => page.id === last.id)) {
    return pages.slice(0, max);
  }
  return [...head, last];
}

function trimBullets(page: OpenSlidePage, cap: number): OpenSlidePage {
  if (page.role !== "content") {
    return page;
  }
  let extras = 0;
  let seenHeading = false;
  const blocks: OpenSlideBlock[] = [];
  for (const block of page.blocks) {
    if (block.kind === "shape" || !block.text.trim()) {
      blocks.push(block);
      continue;
    }
    if (!seenHeading) {
      seenHeading = true;
      blocks.push(block);
      continue;
    }
    extras += 1;
    if (extras <= cap) {
      blocks.push(block);
    }
  }
  return { ...page, blocks };
}

export function applyOpenSlideSkills(
  deck: OpenSlideDeck,
  input: { sourceText?: string; prompt?: string; copy: OpenSlideSkillCopy },
): { deck: OpenSlideDeck; report: OpenSlideSkillReport } {
  const source = (input.sourceText ?? "").trim();
  const topic = deck.brief.topic.trim();
  const supplied = `${input.prompt ?? ""}\n${topic}\n${source}`;
  const allowDigits = /\d/.test(supplied);
  const sourceNorm = source.toLowerCase().replace(/\s+/g, " ");
  const sourceWords = new Set(words(source));
  const lines = sentences(source);
  let line = 0;
  const report: OpenSlideSkillReport = {
    length: "kept",
    notesFilled: 0,
    sourceRewrites: 0,
    figuresCleared: 0,
  };
  const bracket = BRACKET[deck.brief.pageCount];
  let pages = deck.pages;
  if (pages.length > bracket.max) {
    pages = trimPages(pages, bracket.max);
    report.length = "trimmed";
  } else if (pages.length < bracket.min) {
    report.length = "short";
  }
  const cap = BULLET_CAP[deck.brief.density];
  pages = pages.map((page) => {
    let next = trimBullets(page, cap);
    if (!next.notes.trim()) {
      next = { ...next, notes: input.copy.note.slice(0, 2000) };
      report.notesFilled += 1;
    }
    const blocks = next.blocks.map((block) => {
      if (block.kind === "shape" || !block.text.trim()) {
        return block;
      }
      if (topic && block.text.trim() === topic) {
        return block;
      }
      let text = block.text;
      if (source && !supported(text, sourceNorm, sourceWords) && lines.length > 0) {
        const replacement = lines[line % lines.length] ?? text;
        line += 1;
        if (replacement !== text) {
          text = replacement;
          report.sourceRewrites += 1;
        }
      }
      if (!allowDigits && /\d/.test(text)) {
        text = input.copy.noFigure;
        report.figuresCleared += 1;
      }
      return text === block.text ? block : { ...block, text: text.slice(0, 500) };
    });
    return { ...next, blocks };
  });
  return { deck: { ...deck, pages }, report };
}
