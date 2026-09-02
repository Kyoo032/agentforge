import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import {
  extractJsonObject,
  parsePresentationOutline,
  parsePresentationOutlineBody,
  mergePresentationSlide,
} from "./presentation-outline";

describe("extractJsonObject", () => {
  it("pulls the outer object from prose", () => {
    expect(extractJsonObject('Here you go:\n{"title":"A","slides":[]}\n')).toBe(
      '{"title":"A","slides":[]}',
    );
  });

  it("strips markdown fences", () => {
    expect(extractJsonObject('```json\n{"title":"B","slides":[{"heading":"H","bullets":[],"notes":""}]}\n```')).toContain(
      '"title":"B"',
    );
  });

  it("fails when no object is present", () => {
    expect(() => extractJsonObject("not json")).toThrow(ApiError);
  });
});

describe("parsePresentationOutline", () => {
  const valid = {
    title: "Quarterly plan",
    slides: [
      { heading: "Goals", bullets: ["Ship v1", "Measure adoption"], notes: "Keep short" },
      { heading: "Next steps", bullets: ["Pilot"], notes: "" },
    ],
  };

  it("accepts a valid outline string", () => {
    expect(parsePresentationOutline(JSON.stringify(valid))).toEqual(valid);
  });

  it("defaults missing bullets and notes", () => {
    const raw = JSON.stringify({
      title: "Deck",
      slides: [{ heading: "Only heading" }],
    });
    expect(parsePresentationOutline(raw)).toEqual({
      title: "Deck",
      slides: [{ heading: "Only heading", bullets: [], notes: "" }],
    });
  });

  it("fails closed on invalid JSON", () => {
    expect(() => parsePresentationOutline("{not-json")).toThrow(ApiError);
  });

  it("fails closed on empty slides", () => {
    expect(() => parsePresentationOutline(JSON.stringify({ title: "X", slides: [] }))).toThrow(ApiError);
  });

  it("fails closed on non-string input", () => {
    expect(() => parsePresentationOutline(valid)).toThrow(ApiError);
  });
});

describe("parsePresentationOutlineBody", () => {
  it("accepts a validated object body", () => {
    const outline = parsePresentationOutlineBody({
      title: "Body deck",
      slides: [{ heading: "One", bullets: ["a"], notes: "" }],
    });
    expect(outline.title).toBe("Body deck");
  });

  it("rejects missing title", () => {
    expect(() =>
      parsePresentationOutlineBody({ slides: [{ heading: "H", bullets: [], notes: "" }] }),
    ).toThrow(ApiError);
  });
});

describe("mergePresentationSlide", () => {
  it("replaces one slide by index", () => {
    const outline = parsePresentationOutlineBody({
      title: "Body deck",
      slides: [
        { heading: "One", bullets: ["a"], notes: "" },
        { heading: "Two", bullets: ["b"], notes: "" },
      ],
    });
    const next = mergePresentationSlide(outline, 0, { heading: "New", bullets: ["c"], notes: "" });
    expect(next.slides[0]?.heading).toBe("New");
    expect(next.slides[1]?.heading).toBe("Two");
  });
});
