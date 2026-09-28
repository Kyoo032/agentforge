import { describe, expect, it } from "vitest";
import { repairNultronDesign, repairNultronOutline } from "./presentation-harness";
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

  it("assigns a layout and cuts a crowded slide without changing a supplied figure", () => {
    const longTitle = "Saturday pickup packed 12 named bags for the counter this week please";
    const designed = repairNultronDesign({
      title: longTitle,
      slides: [
        {
          kind: "bullets",
          heading: "Named bags",
          subhead: "",
          bullets: ["The counter packed 12 bags.", "Two", "Three", "Four", "Five", "Six extra"],
          aside: "",
          notes: "Stay.",
        },
      ],
    });
    expect(designed.title).toContain("12");
    expect(designed.title.length).toBeLessThanOrEqual(43);
    expect(designed.slides[0]?.layout).toBe("split");
    expect(designed.slides[0]?.bullets.length).toBeLessThanOrEqual(5);
    expect(designed.slides[0]?.bullets.join(" ")).toContain("12");
    expect(designed.slides).toHaveLength(1);
  });
});
