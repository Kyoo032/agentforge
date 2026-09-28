import { describe, expect, it } from "vitest";
import { repairNultronOutline } from "./presentation-harness";
import type { PresentationOutline } from "./presentation-outline";

const COPY = {
  note: "Say this page once, then stop. Do not add a number you were not given.",
  noFigure: "No figure supplied",
};

const outline: PresentationOutline = {
  title: "Saturday pickup",
  slides: [
    {
      kind: "bullets",
      heading: "Named bags are on the counter",
      subhead: "",
      bullets: ["Uptime reached 94% last week."],
      aside: "",
      notes: "",
    },
    {
      kind: "close",
      heading: "Reprint the door menu",
      subhead: "",
      bullets: [],
      aside: "",
      notes: "Ask for a yes or a no.",
    },
  ],
};

describe("repairNultronOutline", () => {
  it("fills an empty note and drops a figure the topic never gave", () => {
    const repaired = repairNultronOutline(outline, { prompt: "Saturday pickup", ...COPY });
    expect(repaired.slides[0]?.notes).toBe(COPY.note);
    expect(repaired.slides[0]?.bullets[0]).toBe(COPY.noFigure);
    expect(repaired.slides[1]?.notes).toBe("Ask for a yes or a no.");
  });

  it("uses a handed sentence in place of an unsupported bullet", () => {
    const source = "The counter opens at seven on Saturday for named bags.";
    const repaired = repairNultronOutline(outline, { prompt: "Saturday pickup", sourceText: source, ...COPY });
    expect(repaired.slides[0]?.bullets[0]).toBe(source);
    expect(repaired.slides[0]?.notes).toBe(COPY.note);
  });
});
