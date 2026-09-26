import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core/errors";
import {
  extractJsonObject,
  parsePresentationOutline,
  parsePresentationOutlineBody,
  parsePresentationSlide,
  mergePresentationSlide,
  resolvePresentationSlideLayout,
} from "./presentation-outline";

describe("extractJsonObject", () => {
  it("pulls the outer object from prose", () => {
    expect(extractJsonObject('Here you go:\n{"title":"A","slides":[]}\n')).toBe('{"title":"A","slides":[]}');
  });

  it("strips markdown fences", () => {
    expect(
      extractJsonObject('```json\n{"title":"B","slides":[{"heading":"H","bullets":[],"notes":""}]}\n```'),
    ).toContain('"title":"B"');
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
    expect(parsePresentationOutline(JSON.stringify(valid))).toEqual({
      title: "Quarterly plan",
      slides: [
        {
          kind: "bullets",
          heading: "Goals",
          subhead: "",
          bullets: ["Ship v1", "Measure adoption"],
          aside: "",
          notes: "Keep short",
          shapes: [],
        },
        { kind: "bullets", heading: "Next steps", subhead: "", bullets: ["Pilot"], aside: "", notes: "", shapes: [] },
      ],
    });
  });

  it("defaults missing bullets, notes, kind, subhead, and aside", () => {
    const raw = JSON.stringify({
      title: "Deck",
      slides: [{ heading: "Only heading" }],
    });
    expect(parsePresentationOutline(raw)).toEqual({
      title: "Deck",
      slides: [
        { kind: "bullets", heading: "Only heading", subhead: "", bullets: [], aside: "", notes: "", shapes: [] },
      ],
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
    expect(() => parsePresentationOutlineBody({ slides: [{ heading: "H", bullets: [], notes: "" }] })).toThrow(
      ApiError,
    );
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
    const next = mergePresentationSlide(
      outline,
      0,
      parsePresentationSlide({ heading: "New", bullets: ["c"], notes: "" }),
    );
    expect(next.slides[0]?.heading).toBe("New");
    expect(next.slides[1]?.heading).toBe("Two");
  });
});

describe("resolvePresentationSlideLayout", () => {
  it("applies split and close when every slide is bullets", () => {
    const { slides } = parsePresentationOutlineBody({
      title: "Thin",
      slides: [
        { heading: "A", bullets: ["1", "2", "3"], notes: "" },
        { heading: "B", bullets: ["4", "5", "6"], notes: "" },
        { heading: "C", bullets: ["7", "8", "9"], notes: "" },
      ],
    });
    expect(resolvePresentationSlideLayout(slides, 0).kind).toBe("bullets");
    const split = resolvePresentationSlideLayout(slides, 1);
    expect(split.kind).toBe("split");
    expect(split.bullets).toEqual(["4", "5"]);
    expect(split.aside).toBe("6");
    expect(resolvePresentationSlideLayout(slides, 2).kind).toBe("close");
  });

  it("respects mixed kinds from the model", () => {
    const { slides } = parsePresentationOutlineBody({
      title: "Mixed",
      slides: [
        { kind: "section", heading: "Open", subhead: "Line", bullets: [], notes: "" },
        { kind: "bullets", heading: "Body", bullets: ["a", "b", "c"], notes: "" },
        { kind: "close", heading: "Ask", bullets: ["yes"], notes: "" },
      ],
    });
    expect(resolvePresentationSlideLayout(slides, 0).kind).toBe("section");
    expect(resolvePresentationSlideLayout(slides, 1).kind).toBe("bullets");
    expect(resolvePresentationSlideLayout(slides, 2).kind).toBe("close");
  });
});
