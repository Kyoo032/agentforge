import { resolvedProductName } from "@agentforge/core";
import { toneColor, type OpenSlideBlock, type OpenSlideDeck } from "@agentforge/core/open-slide";
import PptxGenJS from "pptxgenjs";

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const PX_W = 1920;
const PX_H = 1080;

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

function safeFilename(title: string): string {
  const cleaned = title
    .replace(/[^\w\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${cleaned || "presentation"}.pptx`;
}

function officeHex(value: string): string {
  return value.replace("#", "").toUpperCase();
}

function inchesX(px: number): number {
  return (px / PX_W) * SLIDE_W;
}

function inchesY(px: number): number {
  return (px / PX_H) * SLIDE_H;
}

function points(px: number): number {
  return Math.max(8, Math.round(px * 0.5));
}

function addBlock(pptx: PptxGenJS, slide: PptxSlide, deck: OpenSlideDeck, block: OpenSlideBlock): void {
  const x = inchesX(block.x);
  const y = inchesY(block.y);
  const w = inchesX(block.w);
  const h = inchesY(block.h);
  const color = officeHex(toneColor(deck.design, block.tone));
  if (block.kind === "shape") {
    slide.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w,
      h,
      fill: { color },
      line: { color, width: 0 },
    });
    return;
  }
  if (!block.text.trim()) {
    return;
  }
  slide.addText(block.text, {
    x,
    y,
    w,
    h,
    fontFace: "Calibri",
    fontSize: points(block.fontSize),
    bold: block.weight >= 700,
    color,
    align: block.align,
    valign: "top",
    margin: 0,
  });
}

/** One Office slide per Open Slide page. Coordinates are the 1920×1080 canvas. */
export async function buildOpenSlidePptx(deck: OpenSlideDeck): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "OPEN_SLIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "OPEN_SLIDE";
  pptx.author = resolvedProductName();
  pptx.title = deck.meta.title;
  const bg = officeHex(deck.design.palette.bg);
  for (const page of deck.pages) {
    const slide = pptx.addSlide();
    slide.background = { color: bg };
    for (const block of page.blocks) {
      addBlock(pptx, slide, deck, block);
    }
    if (page.notes.trim()) {
      slide.addNotes(page.notes.trim());
    }
  }
  const output = await pptx.write({ outputType: "arraybuffer" });
  return { buffer: output as ArrayBuffer, filename: safeFilename(deck.meta.title) };
}
