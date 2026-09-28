import type { PresentationOutline, PresentationSlide } from "./presentation-outline";

/**
 * Nultron outline checks for the same three skills as Open Slide.
 * Length is not applied here: that builder has no page-count bracket on the request.
 */

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
    .map((part) => (part.length > 220 ? `${part.slice(0, 219).trimEnd()}…` : part));
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

function repairSlide(
  slide: PresentationSlide,
  input: {
    source: string;
    sourceNorm: string;
    sourceWords: Set<string>;
    lines: string[];
    cursor: { line: number };
    allowDigits: boolean;
    note: string;
    noFigure: string;
  },
): PresentationSlide {
  const notes = slide.notes.trim() ? slide.notes : input.note;
  const rewrite = (text: string): string => {
    let next = text;
    if (
      input.source &&
      next.trim() &&
      !supported(next, input.sourceNorm, input.sourceWords) &&
      input.lines.length > 0
    ) {
      next = input.lines[input.cursor.line % input.lines.length] ?? next;
      input.cursor.line += 1;
    }
    if (!input.allowDigits && /\d/.test(next)) {
      return input.noFigure;
    }
    return next;
  };
  return {
    ...slide,
    notes,
    aside: slide.aside.trim() ? rewrite(slide.aside) : slide.aside,
    bullets: slide.bullets.map((bullet) => rewrite(bullet)),
  };
}

export function repairNultronOutline(
  outline: PresentationOutline,
  input: { sourceText?: string; prompt?: string; note: string; noFigure: string },
  onlyIndex?: number,
): PresentationOutline {
  const source = (input.sourceText ?? "").trim();
  const supplied = `${input.prompt ?? ""}\n${outline.title}\n${source}`;
  const shared = {
    source,
    sourceNorm: source.toLowerCase().replace(/\s+/g, " "),
    sourceWords: new Set(words(source)),
    lines: sentences(source),
    cursor: { line: 0 },
    allowDigits: /\d/.test(supplied),
    note: input.note,
    noFigure: input.noFigure,
  };
  return {
    ...outline,
    slides: outline.slides.map((slide, index) =>
      onlyIndex !== undefined && index !== onlyIndex ? slide : repairSlide(slide, shared),
    ),
  };
}
