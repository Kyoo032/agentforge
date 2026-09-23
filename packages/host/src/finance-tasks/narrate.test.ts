import { describe, expect, it } from "vitest";
import { UNVERIFIED_MARKER } from "@agentforge/core/finance";
import { guardNarration, parseNarration } from "./narrate";

const SECTIONS = [
  { id: "position", title: { id: "Posisi", en: "Position" } },
  { id: "outlook", title: { id: "Prospek", en: "Outlook" } },
];

function draftOf(narration: Record<string, unknown>) {
  return parseNarration(JSON.stringify(narration), SECTIONS, "How is cash?");
}

describe("guardNarration", () => {
  // The guard used to read the bodies only; a figure in a title, a heading or an assumption reached
  // the reader as though it had been computed.
  it("guards the title, every heading and every assumption, and never leaves the marker in them", () => {
    const draft = draftOf({
      title: "Cash lasts 14 months",
      sections: [
        { id: "position", heading: "Cash sits at 900 after a 35% drop", body: "Cash was 900." },
        { id: "outlook", heading: "What comes next", body: "Burn was 1234 a month." },
      ],
      assumptions: ["Monthly figures.", "A 5% raise lands in March."],
    });
    const { prose, guard } = guardNarration(draft, [900]);
    expect(prose.title).toBe("How is cash?");
    expect(prose.sections.map((section) => section.heading)).toEqual([
      "Cash sits at 900 after a drop",
      "What comes next",
    ]);
    expect(prose.assumptions).toEqual(["Monthly figures."]);
    const shown = [prose.title, ...prose.sections.map((section) => section.heading), ...prose.assumptions];
    expect(shown.join(" ")).not.toContain(UNVERIFIED_MARKER);
    // A body keeps its marker: the repair rewrites it once, then takes the sentence out.
    expect(prose.sections[1]?.body).toBe(`Burn was ${UNVERIFIED_MARKER} a month.`);
    expect(guard.flagged).toEqual([
      { section: -1, text: "14" },
      { section: 0, text: "35%" },
      { section: 1, text: "1234" },
      { section: -1, text: "5%" },
    ]);
    expect(guard.total).toBe(4);
  });

  it("never counts the reader's own question against the model when it stands in as the title", () => {
    const draft = parseNarration(
      JSON.stringify({ sections: [{ id: "position", heading: "Where cash sits", body: "Cash was 900." }] }),
      SECTIONS,
      "Does Rp 500 juta last to March?",
    );
    const { prose, guard } = guardNarration(draft, [900]);
    expect(prose.title).toBe("Does Rp 500 juta last to March?");
    expect(guard.total).toBe(0);
  });

  it("leaves prose whose every figure traces exactly as it was written", () => {
    const draft = draftOf({
      title: "Cash at 900",
      sections: [{ id: "position", heading: "900 in the bank", body: "Cash was 900 in 2025." }],
      assumptions: ["Figures for 2025."],
    });
    const { prose, guard } = guardNarration(draft, [900]);
    expect(prose).toEqual({
      title: "Cash at 900",
      sections: [{ id: "position", heading: "900 in the bank", body: "Cash was 900 in 2025." }],
      assumptions: ["Figures for 2025."],
    });
    expect(guard).toEqual({ flagged: [], total: 0 });
  });
});
