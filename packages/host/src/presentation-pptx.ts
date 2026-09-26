import PptxGenJS from "pptxgenjs";
import { resolvedProductName } from "@agentforge/core";
import {
  resolvePresentationSlideLayout,
  type PresentationOutline,
  type PresentationSlide,
} from "./presentation-outline";
import { presentationKicker, presentationLocale, type PresentationLocale } from "./presentation-locale";

type PptxSlide = ReturnType<PptxGenJS["addSlide"]>;

/** Quiet-tool tokens (Chat / studio), hex for Office. Not the old navy template. */
const COLORS = {
  accent: "0F766E",
  text: "292929",
  text2: "5D5D5D",
  text3: "9E9E9E",
  bg: "F7F7F6",
  surface: "FFFFFF",
  line: "ECECE8",
} as const;

const FONT = "Calibri";
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

function hexColor(value: string, fallback: string): string {
  return /^[0-9A-Fa-f]{6}$/.test(value) ? value.toUpperCase() : fallback;
}

/**
 * Stage shapes, written as basic Office shapes in the same boxes.
 * Not a master, a table, or a chart.
 */
function addOwnerShapes(pptx: PptxGenJS, slide: PptxSlide, shapes: PresentationSlide["shapes"]): void {
  for (const shape of shapes) {
    const x = (shape.x / 100) * SLIDE_W;
    const y = (shape.y / 100) * SLIDE_H;
    const w = Math.min((shape.w / 100) * SLIDE_W, SLIDE_W - x);
    const h = Math.min((shape.h / 100) * SLIDE_H, SLIDE_H - y);
    if (w <= 0 || h <= 0) {
      continue;
    }
    const fill = hexColor(shape.fill, COLORS.bg);
    const stroke = hexColor(shape.stroke, COLORS.accent);
    const box = { x, y, w, h, fill: { color: fill }, line: { color: stroke, width: 1.5 } };
    if (shape.kind === "rectangle") {
      slide.addShape(pptx.ShapeType.rect, box);
    } else if (shape.kind === "rounded") {
      slide.addShape(pptx.ShapeType.roundRect, box);
    } else if (shape.kind === "ellipse") {
      slide.addShape(pptx.ShapeType.ellipse, box);
    } else if (shape.kind === "triangle") {
      slide.addShape(pptx.ShapeType.triangle, box);
    } else if (shape.kind === "line") {
      slide.addShape(pptx.ShapeType.line, { x, y, w, h, line: { color: stroke, width: 1.75 } });
    } else if (shape.kind === "arrow") {
      slide.addShape(pptx.ShapeType.rightArrow, box);
    } else if (shape.kind === "star") {
      slide.addShape(pptx.ShapeType.star5, box);
    } else if (shape.kind === "callout") {
      slide.addShape(pptx.ShapeType.wedgeRoundRectCallout, box);
    }
    if (shape.kind === "text" || shape.text.trim()) {
      slide.addText(shape.text, {
        x,
        y,
        w,
        h,
        fontSize: 14,
        fontFace: FONT,
        color: shape.kind === "text" ? stroke : COLORS.text,
        valign: "middle",
        align: "center",
      });
    }
  }
}

function safeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "presentation"}.pptx`;
}

function addChrome(pptx: PptxGenJS, slide: PptxSlide, opts: { fill: string; productName: string; page: string }): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: "100%",
    h: "100%",
    fill: { color: opts.fill },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.12,
    h: "100%",
    fill: { color: COLORS.accent },
  });
  slide.addText(opts.productName, {
    x: 0.7,
    y: 7.12,
    w: 8,
    h: 0.24,
    fontSize: 11,
    fontFace: FONT,
    color: COLORS.text3,
  });
  slide.addText(opts.page, {
    x: 10.4,
    y: 7.12,
    w: 2.2,
    h: 0.24,
    fontSize: 11,
    fontFace: FONT,
    color: COLORS.text3,
    align: "right",
  });
}

function addNotes(slide: PptxSlide, notes: string): void {
  if (notes.trim()) {
    slide.addNotes(notes.trim());
  }
}

function addTitleSlide(
  pptx: PptxGenJS,
  title: string,
  productName: string,
  total: number,
  locale: PresentationLocale,
): void {
  const slide = pptx.addSlide();
  addChrome(pptx, slide, { fill: COLORS.bg, productName, page: `1 / ${total}` });
  slide.addText(presentationKicker(locale), {
    x: 0.8,
    y: 2.15,
    w: 11.6,
    h: 0.32,
    fontSize: 12,
    fontFace: FONT,
    bold: true,
    color: COLORS.text3,
    charSpacing: 3,
  });
  slide.addText(title, {
    x: 0.8,
    y: 2.55,
    w: 11.6,
    h: 2.2,
    fontSize: 36,
    fontFace: FONT,
    bold: true,
    color: COLORS.text,
    align: "left",
    valign: "top",
  });
}

function addBulletBlock(
  slide: PptxSlide,
  bullets: string[],
  box: { x: number; y: number; w: number; h: number },
): void {
  if (bullets.length === 0) {
    return;
  }
  slide.addText(
    bullets.map((bullet) => ({
      text: bullet,
      options: { bullet: true, breakLine: true },
    })),
    {
      ...box,
      fontSize: 16,
      fontFace: FONT,
      color: COLORS.text2,
      paraSpaceAfter: 12,
      valign: "top",
    },
  );
}

function addContentSlide(
  pptx: PptxGenJS,
  slides: PresentationOutline["slides"],
  index: number,
  productName: string,
  page: string,
): void {
  const item = resolvePresentationSlideLayout(slides, index);
  const slide = pptx.addSlide();
  const kind = item.kind;
  addChrome(pptx, slide, { fill: COLORS.surface, productName, page });
  addNotes(slide, item.notes);

  if (kind === "section") {
    slide.addText(item.heading, {
      x: 0.9,
      y: 2.2,
      w: 11.4,
      h: 1.6,
      fontSize: 32,
      fontFace: FONT,
      bold: true,
      color: COLORS.text,
      valign: "bottom",
    });
    if (item.subhead.trim()) {
      slide.addText(item.subhead, {
        x: 0.9,
        y: 3.95,
        w: 11.4,
        h: 1.1,
        fontSize: 18,
        fontFace: FONT,
        color: COLORS.text2,
      });
    }
    addOwnerShapes(pptx, slide, item.shapes);
    return;
  }

  slide.addText(item.heading, {
    x: 0.7,
    y: 0.42,
    w: 11.9,
    h: 0.85,
    fontSize: 26,
    fontFace: FONT,
    bold: true,
    color: COLORS.text,
  });
  if (item.subhead.trim()) {
    slide.addText(item.subhead, {
      x: 0.7,
      y: 1.22,
      w: 11.9,
      h: 0.4,
      fontSize: 14,
      fontFace: FONT,
      color: COLORS.text2,
    });
  }

  if (kind === "close") {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.7,
      y: item.subhead.trim() ? 1.68 : 1.32,
      w: 1.8,
      h: 0.05,
      fill: { color: COLORS.accent },
    });
  }

  const bodyY = item.subhead.trim() ? 1.85 : kind === "close" ? 1.55 : 1.45;

  if (kind === "split") {
    addBulletBlock(slide, item.bullets, { x: 0.75, y: bodyY, w: 6.6, h: 5.1 });
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 7.6,
      y: bodyY,
      w: 4.9,
      h: 4.6,
      fill: { color: COLORS.bg },
      rectRadius: 0.08,
    });
    slide.addText(item.aside, {
      x: 7.85,
      y: bodyY + 0.25,
      w: 4.4,
      h: 4.1,
      fontSize: 16,
      fontFace: FONT,
      color: COLORS.text,
      valign: "middle",
    });
    addOwnerShapes(pptx, slide, item.shapes);
    return;
  }

  addBulletBlock(slide, item.bullets, { x: 0.75, y: bodyY, w: 11.7, h: 5.2 });
  addOwnerShapes(pptx, slide, item.shapes);
}

/** Build a PPTX ArrayBuffer from a validated outline. */
export async function buildPresentationPptx(
  outline: PresentationOutline,
  options?: { locale?: PresentationLocale },
): Promise<{
  buffer: ArrayBuffer;
  filename: string;
}> {
  const locale = options?.locale ?? presentationLocale();
  const productName = resolvedProductName();
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "AGENTFORGE_WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "AGENTFORGE_WIDE";
  pptx.author = productName;
  pptx.title = outline.title;

  const total = outline.slides.length + 1;
  addTitleSlide(pptx, outline.title, productName, total, locale);
  outline.slides.forEach((_item, index) => {
    addContentSlide(pptx, outline.slides, index, productName, `${index + 2} / ${total}`);
  });

  const output = await pptx.write({ outputType: "arraybuffer" });
  return {
    buffer: output as ArrayBuffer,
    filename: safeFilename(outline.title),
  };
}
