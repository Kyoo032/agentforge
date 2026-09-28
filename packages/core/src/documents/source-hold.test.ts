import { describe, expect, it } from "vitest";
import { holdDraftToSource } from "./source-hold";

const draft = {
  title: "Field note for the week",
  sections: [
    {
      heading: "What shipped",
      body: "The rail on this desk already shows every work mode. The installer was last built in August.",
    },
    {
      heading: "What I need from you",
      body: "Approve the Saturday reader before Friday so the counter can keep the current card.",
    },
  ],
};

const source =
  "The rail on this desk already shows every work mode. Approve the Saturday reader before Friday so the counter can keep the current card.";

describe("holdDraftToSource", () => {
  it("runs with no model and drops a sentence the source does not support", () => {
    const held = holdDraftToSource(draft, source, "Not in the source.");
    expect(held.sections[0]?.body).toBe("The rail on this desk already shows every work mode.");
    expect(held.sections[0]?.body).not.toMatch(/August/);
    expect(held.sections[1]).toEqual(draft.sections[1]);
    expect(held.title).toBe(draft.title);
  });

  it("drops a sentence that adds a number the source never stated", () => {
    const numbered = {
      title: "Field note",
      sections: [
        {
          heading: "What shipped",
          body: "The rail on this desk already shows 14 work modes.",
        },
      ],
    };
    const held = holdDraftToSource(numbered, source, "Not in the source.");
    expect(held.sections[0]?.body).toBe("Not in the source.");
  });

  it("leaves the draft alone when there is no source", () => {
    expect(holdDraftToSource(draft, "  ", "Not in the source.")).toBe(draft);
  });

  it("holds only the rewritten section", () => {
    const held = holdDraftToSource(
      draft,
      "The rail on this desk already shows every work mode.",
      "Tidak ada di sumber.",
      1,
    );
    expect(held.sections[0]).toEqual(draft.sections[0]);
    expect(held.sections[1]?.body).toBe("Tidak ada di sumber.");
  });
});
