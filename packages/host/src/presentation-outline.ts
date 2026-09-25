import { z } from "zod";
import { ApiError } from "@agentforge/core";

export const presentationSlideKindSchema = z.enum(["section", "bullets", "split", "close"]);

export const presentationShapeKindSchema = z.enum(["rectangle", "ellipse", "text"]);

/** Owner-placed marks. Percent of the slide, not a freeform canvas. */
export const presentationShapeSchema = z.object({
  id: z.string().min(1).max(40),
  kind: presentationShapeKindSchema,
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
  w: z.number().finite().min(1).max(100),
  h: z.number().finite().min(1).max(100),
  text: z.string().max(200).default(""),
});

export const presentationSlideSchema = z.object({
  kind: presentationSlideKindSchema.catch("bullets").default("bullets"),
  heading: z.string().min(1),
  subhead: z.string().default(""),
  bullets: z.array(z.string()).default([]),
  aside: z.string().default(""),
  notes: z.string().default(""),
  shapes: z.array(presentationShapeSchema).max(24).default([]),
});

export const presentationOutlineSchema = z.object({
  title: z.string().min(1),
  slides: z.array(presentationSlideSchema).min(1),
});

export type PresentationSlideKind = z.infer<typeof presentationSlideKindSchema>;
export type PresentationSlide = z.infer<typeof presentationSlideSchema>;
export type PresentationOutline = z.infer<typeof presentationOutlineSchema>;

function takeAside(slide: PresentationSlide): { bullets: string[]; aside: string } {
  if (slide.aside.trim()) {
    return { bullets: slide.bullets, aside: slide.aside };
  }
  if (slide.bullets.length >= 3) {
    return {
      bullets: slide.bullets.slice(0, -1),
      aside: slide.bullets[slide.bullets.length - 1] ?? "",
    };
  }
  return { bullets: slide.bullets, aside: "" };
}

/** Layout even when the model only returned heading + bullets. */
export function resolvePresentationSlideLayout(slides: PresentationSlide[], index: number): PresentationSlide {
  const slide = slides[index];
  if (!slide) {
    return { kind: "bullets", heading: "", subhead: "", bullets: [], aside: "", notes: "", shapes: [] };
  }
  const mixed = slides.some((item) => item.kind !== "bullets");
  let kind: PresentationSlideKind = slide.kind;
  if (!mixed) {
    if (index === slides.length - 1) {
      kind = "close";
    } else if (index === Math.floor((slides.length - 1) / 2) && slide.bullets.length >= 3) {
      kind = "split";
    } else {
      kind = "bullets";
    }
  }
  if (kind === "section" && slide.bullets.length >= 3) {
    kind = "bullets";
  }
  if (kind === "split") {
    const split = takeAside(slide);
    if (!split.aside.trim()) {
      return { ...slide, kind: "bullets" };
    }
    return { ...slide, kind, bullets: split.bullets, aside: split.aside };
  }
  return { ...slide, kind };
}

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/** Strip optional markdown fences and isolate the outermost JSON object. */
export function extractJsonObject(text: string): string {
  let trimmed = text.trim();
  const fenced = trimmed.match(FENCE_RE);
  if (fenced?.[1]) {
    trimmed = fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new ApiError("invalid_outline", "Model did not return a JSON presentation outline", 502);
  }
  return trimmed.slice(start, end + 1);
}

/** Parse and validate a presentation outline. Fail closed on invalid JSON or shape. */
export function parsePresentationOutline(raw: unknown): PresentationOutline {
  if (typeof raw !== "string") {
    throw new ApiError("invalid_outline", "Presentation outline must be a JSON string from the model", 502);
  }
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new ApiError("invalid_outline", "Model returned invalid JSON for the presentation outline", 502);
  }
  const result = presentationOutlineSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      "invalid_outline",
      `Presentation outline failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
      502,
    );
  }
  return result.data;
}

export function parsePresentationSlide(raw: unknown): PresentationSlide {
  if (typeof raw === "string") {
    const jsonText = extractJsonObject(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new ApiError("invalid_outline", "Model returned invalid JSON for the slide", 502);
    }
    raw = parsed;
  }
  const result = presentationSlideSchema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      "invalid_outline",
      `Presentation slide failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
      502,
    );
  }
  return result.data;
}

export function mergePresentationSlide(
  outline: PresentationOutline,
  index: number,
  slide: PresentationSlide,
): PresentationOutline {
  if (!Number.isInteger(index) || index < 0 || index >= outline.slides.length) {
    throw new ApiError("invalid_request", "slideIndex is out of range", 400);
  }
  const slides = outline.slides.map((item, itemIndex) => (itemIndex === index ? slide : item));
  return { ...outline, slides };
}

export function parsePresentationOutlineBody(body: unknown): PresentationOutline {
  const result = presentationOutlineSchema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      "invalid_request",
      `Invalid presentation outline: ${result.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }
  return result.data;
}
