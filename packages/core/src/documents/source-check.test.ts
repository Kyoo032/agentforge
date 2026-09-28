import { describe, expect, it } from "vitest";
import { checkDraftAgainstSource } from "./source-check";

const draft = {
  title: "Field note for the week",
  sections: [
    {
      heading: "What shipped",
      body: "The rail on this desk already shows every work mode. The installer was last built in August.",
    },
  ],
};

describe("checkDraftAgainstSource", () => {
  it("does nothing without a source", () => {
    expect(checkDraftAgainstSource(draft, "  ")).toEqual({ checked: false, reason: "no_source", items: [] });
  });

  it("marks a sentence the source does not support and keeps one it does", () => {
    const result = checkDraftAgainstSource(draft, "The rail on this desk already shows every work mode.");
    expect(result.checked).toBe(true);
    const supported = result.items.filter((item) => item.supported).map((item) => item.sentence);
    const unsupported = result.items.filter((item) => !item.supported).map((item) => item.sentence);
    expect(supported.some((sentence) => sentence.includes("every work mode"))).toBe(true);
    expect(unsupported.some((sentence) => sentence.includes("August"))).toBe(true);
  });

  it("marks a sentence that states a number the source never stated", () => {
    const numbered = {
      title: "Field note",
      sections: [
        {
          heading: "What shipped",
          body: "The rail on this desk already shows 14 work modes.",
        },
      ],
    };
    const result = checkDraftAgainstSource(numbered, "The rail on this desk already shows every work mode.");
    expect(result.items.some((item) => item.sentence.includes("14") && !item.supported)).toBe(true);
  });
});
