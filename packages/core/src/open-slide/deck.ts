import { z } from "zod";

/** Fixed canvas from the open-slide authoring rules. Pixels, not percents. */
export const OPEN_SLIDE_CANVAS_WIDTH = 1920;
export const OPEN_SLIDE_CANVAS_HEIGHT = 1080;
export const OPEN_SLIDE_PADDING = 120;
export const OPEN_SLIDE_NUDGE_PX = 8;
export const OPEN_SLIDE_NUDGE_SHIFT_PX = 40;
export const OPEN_SLIDE_MAX_BLOCKS = 12;

export const OPEN_SLIDE_ROLES = [
  "cover",
  "agenda",
  "section",
  "content",
  "big-number",
  "quote",
  "comparison",
  "closing",
] as const;

export const OPEN_SLIDE_PAGE_COUNTS = ["short", "standard", "deep"] as const;
export const OPEN_SLIDE_DENSITIES = ["minimal", "light", "standard", "dense"] as const;
export const OPEN_SLIDE_MOTIONS = ["static", "subtle", "rich"] as const;

export type OpenSlideRole = (typeof OPEN_SLIDE_ROLES)[number];
export type OpenSlidePageCount = (typeof OPEN_SLIDE_PAGE_COUNTS)[number];
export type OpenSlideDensity = (typeof OPEN_SLIDE_DENSITIES)[number];
export type OpenSlideMotion = (typeof OPEN_SLIDE_MOTIONS)[number];
export type OpenSlideTone = "text" | "accent" | "muted" | "bg";
export type OpenSlideAlign = "left" | "center";
export type OpenSlideWeight = 400 | 500 | 800;

export type OpenSlideBlock = {
  id: string;
  kind: "text" | "shape";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  weight: OpenSlideWeight;
  align: OpenSlideAlign;
  tone: OpenSlideTone;
};

export type OpenSlidePage = {
  id: string;
  role: OpenSlideRole;
  /** Assigned after the draft. One of title, section, split, quote, figure. */
  layout?: "title" | "section" | "split" | "quote" | "figure";
  notes: string;
  blocks: OpenSlideBlock[];
};

export type OpenSlideDesign = {
  palette: { bg: string; text: string; accent: string; muted: string };
  fonts: { display: string; body: string };
  typeScale: { hero: number; section: number; heading: number; body: number; caption: number };
  radius: number;
  padding: number;
};

export type OpenSlideBrief = {
  topic: string;
  aesthetic: string;
  pageCount: OpenSlidePageCount;
  density: OpenSlideDensity;
  motion: OpenSlideMotion;
};

export type OpenSlideDeck = {
  engine: "open-slide";
  id: string;
  meta: { title: string; createdAt: string };
  design: OpenSlideDesign;
  brief: OpenSlideBrief;
  pages: OpenSlidePage[];
};

const SYSTEM_FONT = "system-ui, sans-serif";

const hexColor = z
  .string()
  .trim()
  .transform((value) => {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
    return match ? `#${match[1].toLowerCase()}` : "#292929";
  });

const fontStack = z
  .string()
  .transform((value) =>
    /url\(|https?:|@import/i.test(value) ? SYSTEM_FONT : value.trim().slice(0, 120) || SYSTEM_FONT,
  );

function asWeight(value: number): OpenSlideWeight {
  if (value >= 700) {
    return 800;
  }
  if (value >= 500) {
    return 500;
  }
  return 400;
}

const blockSchema = z.object({
  id: z.string().trim().min(1).max(40),
  kind: z.enum(["text", "shape"]).catch("text"),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
  text: z.string().max(500).catch(""),
  fontSize: z.number().finite().catch(40),
  weight: z.number().finite().catch(400).transform(asWeight),
  align: z.enum(["left", "center"]).catch("left"),
  tone: z.enum(["text", "accent", "muted", "bg"]).catch("text"),
});

const slideLayoutSchema = z.preprocess(
  (value) =>
    value === "title" || value === "section" || value === "split" || value === "quote" || value === "figure"
      ? value
      : undefined,
  z.enum(["title", "section", "split", "quote", "figure"]).optional(),
);

const pageSchema = z.object({
  id: z.string().trim().min(1).max(40),
  role: z.enum(OPEN_SLIDE_ROLES).catch("content"),
  layout: slideLayoutSchema,
  notes: z.string().max(2000).catch(""),
  blocks: z.array(blockSchema).max(16),
});

export const openSlideDeckSchema = z.object({
  engine: z.literal("open-slide").catch("open-slide"),
  id: z.string().trim().min(1).max(64),
  meta: z.object({
    title: z.string().trim().min(1).max(200),
    createdAt: z.string().trim().min(4).max(40),
  }),
  design: z.object({
    palette: z.object({
      bg: hexColor,
      text: hexColor,
      accent: hexColor,
      muted: hexColor,
    }),
    fonts: z.object({
      display: fontStack,
      body: fontStack,
    }),
    typeScale: z.object({
      hero: z.number().finite(),
      section: z.number().finite(),
      heading: z.number().finite(),
      body: z.number().finite(),
      caption: z.number().finite(),
    }),
    radius: z.number().finite().catch(12),
    padding: z.number().finite().catch(OPEN_SLIDE_PADDING),
  }),
  brief: z.object({
    topic: z.string().max(500).catch(""),
    aesthetic: z.string().max(300).catch(""),
    pageCount: z.enum(OPEN_SLIDE_PAGE_COUNTS).catch("standard"),
    density: z.enum(OPEN_SLIDE_DENSITIES).catch("light"),
    motion: z.enum(OPEN_SLIDE_MOTIONS).catch("static"),
  }),
  pages: z.array(pageSchema).min(1).max(12),
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampBlock(block: OpenSlideBlock): OpenSlideBlock {
  const w = clamp(Math.round(block.w), 8, OPEN_SLIDE_CANVAS_WIDTH);
  const h = clamp(Math.round(block.h), 8, OPEN_SLIDE_CANVAS_HEIGHT);
  return {
    ...block,
    x: clamp(Math.round(block.x), 0, OPEN_SLIDE_CANVAS_WIDTH - w),
    y: clamp(Math.round(block.y), 0, OPEN_SLIDE_CANVAS_HEIGHT - h),
    w,
    h,
    fontSize: clamp(Math.round(block.fontSize), 12, 200),
    text: block.text.slice(0, 500),
  };
}

export function parseOpenSlideDeck(input: unknown): OpenSlideDeck {
  const parsed = openSlideDeckSchema.parse(input);
  return {
    ...parsed,
    pages: parsed.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => clampBlock(block)),
    })),
  };
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("open_slide_json");
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

export function parseOpenSlideModelText(text: string): OpenSlideDeck {
  return parseOpenSlideDeck(extractJsonObject(text));
}

export function toneColor(design: OpenSlideDesign, tone: OpenSlideTone): string {
  return design.palette[tone];
}

function mapPages(deck: OpenSlideDeck, pageId: string, edit: (page: OpenSlidePage) => OpenSlidePage): OpenSlideDeck {
  return {
    ...deck,
    pages: deck.pages.map((page) => (page.id === pageId ? edit(page) : page)),
  };
}

function mapBlock(
  deck: OpenSlideDeck,
  pageId: string,
  blockId: string,
  edit: (block: OpenSlideBlock) => OpenSlideBlock,
): OpenSlideDeck {
  return mapPages(deck, pageId, (page) => ({
    ...page,
    blocks: page.blocks.map((block) => (block.id === blockId ? clampBlock(edit(block)) : block)),
  }));
}

export function moveOpenSlideBlock(
  deck: OpenSlideDeck,
  pageId: string,
  blockId: string,
  x: number,
  y: number,
): OpenSlideDeck {
  return mapBlock(deck, pageId, blockId, (block) => ({ ...block, x, y }));
}

export function nudgeOpenSlideBlock(
  deck: OpenSlideDeck,
  pageId: string,
  blockId: string,
  dx: number,
  dy: number,
): OpenSlideDeck {
  return mapBlock(deck, pageId, blockId, (block) => ({ ...block, x: block.x + dx, y: block.y + dy }));
}

export function setOpenSlideBlockText(
  deck: OpenSlideDeck,
  pageId: string,
  blockId: string,
  text: string,
): OpenSlideDeck {
  return mapBlock(deck, pageId, blockId, (block) => ({ ...block, text }));
}

export function setOpenSlidePageNotes(deck: OpenSlideDeck, pageId: string, notes: string): OpenSlideDeck {
  return mapPages(deck, pageId, (page) => ({ ...page, notes: notes.slice(0, 2000) }));
}

export function setOpenSlideAccent(deck: OpenSlideDeck, accent: string): OpenSlideDeck {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(accent.trim());
  if (!match) {
    return deck;
  }
  return {
    ...deck,
    design: {
      ...deck.design,
      palette: { ...deck.design.palette, accent: `#${match[1].toLowerCase()}` },
    },
  };
}

export function duplicateOpenSlideBlock(deck: OpenSlideDeck, pageId: string, blockId: string): OpenSlideDeck {
  return mapPages(deck, pageId, (page) => {
    if (page.blocks.length >= OPEN_SLIDE_MAX_BLOCKS) {
      return page;
    }
    const source = page.blocks.find((block) => block.id === blockId);
    if (!source) {
      return page;
    }
    const copyId = nextId(
      page.blocks.map((block) => block.id),
      `${source.id}-c`,
    );
    return {
      ...page,
      blocks: [...page.blocks, clampBlock({ ...source, id: copyId, x: source.x + 24, y: source.y + 24 })],
    };
  });
}

export function removeOpenSlideBlock(deck: OpenSlideDeck, pageId: string, blockId: string): OpenSlideDeck {
  return mapPages(deck, pageId, (page) => {
    if (page.blocks.length <= 1) {
      return page;
    }
    return { ...page, blocks: page.blocks.filter((block) => block.id !== blockId) };
  });
}

export function addOpenSlideTextBlock(deck: OpenSlideDeck, pageId: string): OpenSlideDeck {
  return mapPages(deck, pageId, (page) => {
    if (page.blocks.length >= OPEN_SLIDE_MAX_BLOCKS) {
      return page;
    }
    const id = nextId(
      page.blocks.map((block) => block.id),
      `${page.id}-text`,
    );
    return {
      ...page,
      blocks: [
        ...page.blocks,
        clampBlock({
          id,
          kind: "text",
          x: OPEN_SLIDE_PADDING,
          y: 860,
          w: 800,
          h: 72,
          text: "",
          fontSize: 36,
          weight: 400,
          align: "left",
          tone: "text",
        }),
      ],
    };
  });
}

function nextId(taken: string[], base: string): string {
  const stem = base.slice(0, 36);
  if (!taken.includes(stem)) {
    return stem;
  }
  let n = 2;
  while (taken.includes(`${stem}${n}`)) {
    n += 1;
  }
  return `${stem}${n}`.slice(0, 40);
}

const PAGE_COUNTS = new Set<string>(OPEN_SLIDE_PAGE_COUNTS);
const DENSITIES = new Set<string>(OPEN_SLIDE_DENSITIES);
const MOTIONS = new Set<string>(OPEN_SLIDE_MOTIONS);

export function readOpenSlideChoices(body: unknown): {
  pageCount: OpenSlidePageCount;
  density: OpenSlideDensity;
  motion: OpenSlideMotion;
} {
  const record = body && typeof body === "object" ? (body as { brief?: unknown }).brief : undefined;
  const brief = record && typeof record === "object" ? (record as Record<string, unknown>) : {};
  const pageCount =
    typeof brief.pageCount === "string" && PAGE_COUNTS.has(brief.pageCount) ? brief.pageCount : "standard";
  const density = typeof brief.density === "string" && DENSITIES.has(brief.density) ? brief.density : "light";
  const motion = typeof brief.motion === "string" && MOTIONS.has(brief.motion) ? brief.motion : "static";
  return {
    pageCount: pageCount as OpenSlidePageCount,
    density: density as OpenSlideDensity,
    motion: motion as OpenSlideMotion,
  };
}
