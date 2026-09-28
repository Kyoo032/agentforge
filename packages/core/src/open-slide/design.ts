import {
  assignSlideLayout,
  fitDesignPage,
  inspectSlideDesign,
  textKeepsDigitRuns,
  type DesignText,
  type SlideDesignFailure,
  type SlideLayout,
} from "../presentation/slide-design";
import {
  extractJsonObject,
  parseOpenSlideDeck,
  type OpenSlideBlock,
  type OpenSlideDeck,
  type OpenSlideDensity,
  type OpenSlidePage,
} from "./deck";

/** Same caps the style chip already used. The chip still wins over a longer list. */
export const OPEN_SLIDE_DENSITY_CAP: Record<OpenSlideDensity, number> = {
  minimal: 1,
  light: 3,
  standard: 5,
  dense: 5,
};

function textBlocks(page: OpenSlidePage): OpenSlideBlock[] {
  return page.blocks.filter((block) => block.kind === "text" && block.text.trim());
}

function titleBlock(blocks: OpenSlideBlock[]): OpenSlideBlock | undefined {
  return blocks.reduce<OpenSlideBlock | undefined>(
    (best, block) => (!best || block.fontSize > best.fontSize ? block : best),
    undefined,
  );
}

export function openSlideDesignPages(deck: OpenSlideDeck): DesignText[] {
  return deck.pages.map((page, index) => {
    const texts = textBlocks(page);
    const title = titleBlock(texts);
    return {
      id: page.id,
      index,
      role: page.role,
      title: title?.text ?? "",
      lines: texts.filter((block) => block !== title).map((block) => block.text),
    };
  });
}

export function inspectOpenSlideDesign(deck: OpenSlideDeck): SlideDesignFailure[] {
  return inspectSlideDesign(openSlideDesignPages(deck), OPEN_SLIDE_DENSITY_CAP[deck.brief.density]);
}

function layoutFor(page: OpenSlidePage, index: number, texts: OpenSlideBlock[]): SlideLayout {
  const title = titleBlock(texts);
  const lines = texts.filter((block) => block !== title);
  return assignSlideLayout({ role: page.role, lines: lines.map((block) => block.text) }, index);
}

/** Assign the layout and cut any page that is still crowded. Page count stays put. */
export function repairOpenSlideDesign(deck: OpenSlideDeck): OpenSlideDeck {
  const densityCap = OPEN_SLIDE_DENSITY_CAP[deck.brief.density];
  const pages = deck.pages.map((page, index) => {
    const texts = textBlocks(page);
    const title = titleBlock(texts);
    const layout = layoutFor(page, index, texts);
    const fitted = fitDesignPage(
      {
        id: page.id,
        index,
        role: page.role,
        title: title?.text ?? "",
        lines: texts.filter((block) => block !== title).map((block) => block.text),
      },
      layout,
      densityCap,
    );
    const lineById = new Map<string, string>();
    if (title) {
      lineById.set(title.id, fitted.title);
    }
    const supporting = texts.filter((block) => block !== title);
    supporting.forEach((block, lineIndex) => {
      const next = fitted.lines[lineIndex];
      if (next) {
        lineById.set(block.id, next);
      }
    });
    const drop = new Set(supporting.slice(fitted.lines.length).map((block) => block.id));
    const blocks = page.blocks.flatMap((block) => {
      if (drop.has(block.id)) {
        return [];
      }
      const text = lineById.get(block.id);
      if (text === undefined || text === block.text) {
        return [block];
      }
      return [{ ...block, text: text.slice(0, 500) }];
    });
    return { ...page, layout, blocks };
  });
  return { ...deck, pages };
}

function pageText(page: OpenSlidePage): string {
  return page.blocks.map((block) => block.text).join("\n");
}

/**
 * Replace only the failing pages. A page that adds a digit the deck was not given
 * is left as it was. Extra pages in the answer are ignored.
 */
export function mergeOpenSlideDesignRetry(
  deck: OpenSlideDeck,
  raw: string,
  ids: ReadonlySet<string>,
  allowedDigits: string,
): OpenSlideDeck {
  let parsed: unknown;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    return deck;
  }
  const incoming =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { pages?: unknown }).pages)
      ? (parsed as { pages: unknown[] }).pages
      : [];
  const byId = new Map<string, unknown>();
  for (const page of incoming) {
    if (page && typeof page === "object" && typeof (page as { id?: unknown }).id === "string") {
      const id = (page as { id: string }).id;
      if (ids.has(id)) {
        byId.set(id, page);
      }
    }
  }
  if (byId.size === 0) {
    return deck;
  }
  const pages = deck.pages.map((page) => {
    const next = byId.get(page.id);
    if (!next || typeof next !== "object") {
      return page;
    }
    const text = Array.isArray((next as { blocks?: unknown }).blocks)
      ? (next as { blocks: Array<{ text?: unknown }> }).blocks.map((block) => String(block.text ?? "")).join("\n")
      : "";
    if (!textKeepsDigitRuns(text, `${allowedDigits}\n${pageText(page)}`)) {
      return page;
    }
    try {
      const trial = parseOpenSlideDeck({
        ...deck,
        pages: deck.pages.map((item) => (item.id === page.id ? next : item)),
      });
      return trial.pages.find((item) => item.id === page.id) ?? page;
    } catch {
      return page;
    }
  });
  return { ...deck, pages };
}
