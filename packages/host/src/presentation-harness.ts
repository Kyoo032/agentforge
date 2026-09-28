import {
  assignSlideLayout,
  fitDesignPage,
  inspectSlideDesign,
  textKeepsDigitRuns,
  type DesignText,
  type SlideDesignFailure,
  type SlideLayout,
} from "@agentforge/core";
import { parsePresentationSlide, type PresentationOutline, type PresentationSlide } from "./presentation-outline";

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

function slideLines(slide: PresentationSlide): string[] {
  const lines = [...slide.bullets];
  if (slide.subhead.trim()) {
    lines.push(slide.subhead);
  }
  if (slide.aside.trim()) {
    lines.push(slide.aside);
  }
  return lines;
}

export function nultronDesignPages(outline: PresentationOutline): DesignText[] {
  return [
    { id: "title", index: 0, role: "title", title: outline.title, lines: [] },
    ...outline.slides.map((slide, index) => ({
      id: `slide-${index + 1}`,
      index: index + 1,
      role: slide.kind,
      title: slide.heading,
      lines: slideLines(slide),
    })),
  ];
}

export function inspectNultronDesign(outline: PresentationOutline): SlideDesignFailure[] {
  return inspectSlideDesign(nultronDesignPages(outline));
}

function applyFittedSlide(slide: PresentationSlide, layout: SlideLayout): PresentationSlide {
  const fitted = fitDesignPage(
    { id: "slide", index: 1, role: slide.kind, title: slide.heading, lines: slideLines(slide) },
    layout,
  );
  const nextBullets: string[] = [];
  let subhead = slide.subhead;
  let aside = slide.aside;
  let cursor = 0;
  for (let i = 0; i < slide.bullets.length; i += 1) {
    const next = fitted.lines[cursor];
    cursor += 1;
    if (next) {
      nextBullets.push(next);
    }
  }
  if (slide.subhead.trim()) {
    subhead = fitted.lines[cursor] ?? "";
    cursor += 1;
  }
  if (slide.aside.trim()) {
    aside = fitted.lines[cursor] ?? "";
  }
  return { ...slide, layout, heading: fitted.title || slide.heading, bullets: nextBullets, subhead, aside };
}

/** Assign each slide a layout and cut any page that is still crowded. The slide count stays put. */
export function repairNultronDesign(outline: PresentationOutline): PresentationOutline {
  const titleLayout = assignSlideLayout({ role: "title", lines: [] }, 0);
  const titleFit = fitDesignPage(
    { id: "title", index: 0, role: "title", title: outline.title, lines: [] },
    titleLayout,
  );
  return {
    ...outline,
    title: titleFit.title || outline.title,
    slides: outline.slides.map((slide, index) => {
      const layout = assignSlideLayout({ role: slide.kind, lines: slideLines(slide) }, index + 1);
      return applyFittedSlide(slide, layout);
    }),
  };
}

function slidePlain(slide: PresentationSlide): string {
  return [slide.heading, slide.subhead, slide.aside, ...slide.bullets].join("\n");
}

/**
 * Replace only the failing slides. A slide that adds a digit it was not given
 * stays as it was. The slide count does not change.
 */
export function mergeNultronDesignRetry(
  outline: PresentationOutline,
  raw: string,
  indexes: ReadonlySet<number>,
  allowedDigits: string,
): PresentationOutline {
  let parsed: unknown;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw);
  } catch {
    return outline;
  }
  if (!parsed || typeof parsed !== "object") {
    return outline;
  }
  const record = parsed as { title?: unknown; slides?: unknown };
  let title = outline.title;
  if (typeof record.title === "string" && record.title.trim() && indexes.has(0)) {
    if (textKeepsDigitRuns(record.title, `${allowedDigits}\n${outline.title}`)) {
      title = record.title.trim();
    }
  }
  const incoming = Array.isArray(record.slides) ? record.slides : [];
  const byIndex = new Map<number, unknown>();
  for (const item of incoming) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const index = (item as { index?: unknown }).index;
    if (typeof index === "number" && indexes.has(index)) {
      byIndex.set(index, item);
    }
  }
  const slides = outline.slides.map((slide, index) => {
    const next = byIndex.get(index + 1);
    if (!next) {
      return slide;
    }
    const text = JSON.stringify(next);
    if (!textKeepsDigitRuns(text, `${allowedDigits}\n${slidePlain(slide)}`)) {
      return slide;
    }
    try {
      const parsedSlide = parsePresentationSlide(next);
      return { ...parsedSlide, notes: parsedSlide.notes || slide.notes };
    } catch {
      return slide;
    }
  });
  return { ...outline, title, slides };
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
