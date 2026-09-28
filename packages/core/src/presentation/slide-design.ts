/**
 * Slide design for Presentation. After the pages exist, each page is given one
 * layout from a closed set. Code rejects a crowded page. It does not add a page,
 * and it does not invent or rewrite a figure.
 */

export const SLIDE_LAYOUTS = ["title", "section", "split", "quote", "figure"] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];

export const SLIDE_CROWD_REASONS = ["too_many_bullets", "title_overflow", "wall_of_text"] as const;
export type SlideCrowdReason = (typeof SLIDE_CROWD_REASONS)[number];

/** Budgets a 1920×1080 page can hold. A title layout is the hero line. */
export const SLIDE_DESIGN_LIMITS = {
  titleChars: 42,
  titleWords: 8,
  headingChars: 72,
  headingWords: 14,
  wallChars: 220,
  wallWords: 40,
  supporting: { title: 2, section: 2, split: 5, quote: 2, figure: 2 },
} as const;

export type DesignText = {
  id: string;
  index: number;
  /** Open Slide role or Nultron kind. The first page is the title layout. */
  role: string;
  title: string;
  lines: string[];
};

export type SlideDesignFailure = {
  id: string;
  index: number;
  layout: SlideLayout;
  reasons: SlideCrowdReason[];
};

const LAYOUT_SET = new Set<string>(SLIDE_LAYOUTS);

export function isSlideLayout(value: string): value is SlideLayout {
  return LAYOUT_SET.has(value);
}

function words(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
}

export function assignSlideLayout(page: Pick<DesignText, "role" | "lines">, index: number): SlideLayout {
  if (index === 0 || page.role === "cover" || page.role === "title") {
    return "title";
  }
  if (page.role === "quote") {
    return "quote";
  }
  if (page.role === "big-number" || page.role === "figure") {
    return "figure";
  }
  if (page.role === "comparison" || page.role === "split") {
    return "split";
  }
  if (page.role === "section" || page.role === "closing" || page.role === "close") {
    return page.lines.length > SLIDE_DESIGN_LIMITS.supporting.section ? "split" : "section";
  }
  return page.lines.length > SLIDE_DESIGN_LIMITS.supporting.section ? "split" : "section";
}

export function supportingLineCap(layout: SlideLayout, densityCap?: number): number {
  const layoutCap = SLIDE_DESIGN_LIMITS.supporting[layout];
  if (layout !== "split" || densityCap === undefined) {
    return layoutCap;
  }
  return Math.min(layoutCap, densityCap);
}

function titleBudget(layout: SlideLayout): { chars: number; words: number } {
  if (layout === "title") {
    return { chars: SLIDE_DESIGN_LIMITS.titleChars, words: SLIDE_DESIGN_LIMITS.titleWords };
  }
  return { chars: SLIDE_DESIGN_LIMITS.headingChars, words: SLIDE_DESIGN_LIMITS.headingWords };
}

function isWall(text: string): boolean {
  return words(text).length > SLIDE_DESIGN_LIMITS.wallWords || text.trim().length > SLIDE_DESIGN_LIMITS.wallChars;
}

/** Reasons this page is crowded for the layout it was given. Empty means it fits. */
export function slideCrowdReasons(
  page: Pick<DesignText, "title" | "lines">,
  layout: SlideLayout,
  densityCap?: number,
): SlideCrowdReason[] {
  const reasons: SlideCrowdReason[] = [];
  const budget = titleBudget(layout);
  const title = page.title.trim();
  if (title.length > budget.chars || words(title).length > budget.words) {
    reasons.push("title_overflow");
  }
  if (page.lines.length > supportingLineCap(layout, densityCap)) {
    reasons.push("too_many_bullets");
  }
  if ([title, ...page.lines].some((line) => isWall(line))) {
    reasons.push("wall_of_text");
  }
  return reasons;
}

export function inspectSlideDesign(pages: DesignText[], densityCap?: number): SlideDesignFailure[] {
  const failures: SlideDesignFailure[] = [];
  for (const page of pages) {
    const layout = assignSlideLayout(page, page.index);
    const reasons = slideCrowdReasons(page, layout, densityCap);
    if (reasons.length > 0) {
      failures.push({ id: page.id, index: page.index, layout, reasons });
    }
  }
  return failures;
}

/**
 * Shorten text at a word boundary. A digit run is kept whole or dropped with its
 * word. The result never contains a digit run the input did not contain.
 */
export function fitSlideText(text: string, maxChars: number, maxWords: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "";
  }
  let kept = words(trimmed).slice(0, Math.max(1, maxWords));
  const join = (): string => kept.join(" ");
  while (kept.length > 1 && join().length > maxChars) {
    kept = kept.slice(0, -1);
  }
  let joined = join();
  if (joined.length > maxChars) {
    if (/\d/.test(joined)) {
      return "";
    }
    joined = joined.slice(0, Math.max(1, maxChars - 1)).trimEnd();
  }
  if (joined === trimmed) {
    return trimmed;
  }
  if (!joined) {
    return "";
  }
  const withMark = `${joined}…`;
  if (withMark.length <= maxChars + 1) {
    return withMark;
  }
  return joined;
}

/** True when every digit run in `next` is a complete run already present in `allowed`. */
export function textKeepsDigitRuns(next: string, allowed: string): boolean {
  const pool = allowed.match(/\d+/g) ?? [];
  for (const run of next.match(/\d+/g) ?? []) {
    const at = pool.indexOf(run);
    if (at < 0) {
      return false;
    }
    pool.splice(at, 1);
  }
  return true;
}

export function fitDesignPage(
  page: DesignText,
  layout: SlideLayout,
  densityCap?: number,
): { title: string; lines: string[] } {
  const budget = titleBudget(layout);
  const title = fitSlideText(page.title, budget.chars, budget.words);
  const cap = supportingLineCap(layout, densityCap);
  const lines = page.lines.slice(0, cap).map((line) => {
    if (!isWall(line) && line.trim().length <= SLIDE_DESIGN_LIMITS.wallChars) {
      return line.trim();
    }
    return fitSlideText(line, SLIDE_DESIGN_LIMITS.wallChars, SLIDE_DESIGN_LIMITS.wallWords);
  });
  return { title, lines: lines.filter((line) => line.trim().length > 0) };
}
