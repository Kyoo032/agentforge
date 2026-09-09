import PptxGenJS from "pptxgenjs";
import { resolvedProductName } from "@agentforge/core";
import type { PresentationOutline } from "./presentation-outline";

/** DPSBuddy slide tokens (navy / mist / paper / ink) — not purple-gradient AI defaults. */
const COLORS = {
  navy: "1565C0",
  mist: "D6E4F5",
  paper: "FFFFFF",
  ink: "0D2137",
  inkMuted: "4A6075",
} as const;

function safeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${base || "presentation"}.pptx`;
}

/** Build a PPTX ArrayBuffer from a validated outline. */
export async function buildPresentationPptx(outline: PresentationOutline): Promise<{
  buffer: ArrayBuffer;
  filename: string;
}> {
  const productName = resolvedProductName();
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "AGENTFORGE_WIDE", width: 13.333, height: 7.5 });
  pptx.layout = "AGENTFORGE_WIDE";
  pptx.author = productName;
  pptx.title = outline.title;

  // Title slide
  {
    const slide = pptx.addSlide();
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      fill: { color: COLORS.navy },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 6.6,
      w: "100%",
      h: 0.9,
      fill: { color: COLORS.mist },
    });
    slide.addText(outline.title, {
      x: 0.8,
      y: 2.6,
      w: 11.7,
      h: 1.6,
      fontSize: 40,
      fontFace: "Calibri",
      bold: true,
      color: COLORS.paper,
      align: "left",
      valign: "middle",
    });
    slide.addText(productName, {
      x: 0.8,
      y: 6.75,
      w: 11.7,
      h: 0.4,
      fontSize: 12,
      fontFace: "Calibri",
      color: COLORS.ink,
    });
  }

  for (const item of outline.slides) {
    const slide = pptx.addSlide();
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: "100%",
      h: "100%",
      fill: { color: COLORS.paper },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.18,
      h: "100%",
      fill: { color: COLORS.navy },
    });
    slide.addText(item.heading, {
      x: 0.7,
      y: 0.45,
      w: 11.9,
      h: 0.9,
      fontSize: 28,
      fontFace: "Calibri",
      bold: true,
      color: COLORS.ink,
    });
    if (item.bullets.length > 0) {
      slide.addText(
        item.bullets.map((bullet) => ({
          text: bullet,
          options: { bullet: true, breakLine: true },
        })),
        {
          x: 0.9,
          y: 1.55,
          w: 11.5,
          h: 5.2,
          fontSize: 18,
          fontFace: "Calibri",
          color: COLORS.ink,
          paraSpaceAfter: 10,
        },
      );
    }
    if (item.notes.trim()) {
      slide.addNotes(item.notes.trim());
    }
  }

  const output = await pptx.write({ outputType: "arraybuffer" });
  return {
    buffer: output as ArrayBuffer,
    filename: safeFilename(outline.title),
  };
}
