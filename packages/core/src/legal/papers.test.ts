import { describe, expect, it } from "vitest";
import { assumeSingleCounterpartyDraft } from "./papers";
import type { MatterDocCard } from "./types";

function card(id: string, role: MatterDocCard["role"]): MatterDocCard {
  return {
    id,
    name: `${id}.docx`,
    path: `${id}.docx`,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: 10,
    sha256: "ab",
    role,
    status: "read",
    paragraphs: 1,
    words: 1,
    insertions: 0,
    deletions: 0,
    definedTerms: 0,
    preview: "",
  };
}

describe("assumeSingleCounterpartyDraft", () => {
  it("leaves a draft the person or classify already named", () => {
    const result = assumeSingleCounterpartyDraft([card("S1", "counterparty-draft"), card("S2", "context")]);
    expect(result.assumed).toBeNull();
    expect(result.cards.map((item) => item.role)).toEqual(["counterparty-draft", "context"]);
  });

  it("treats the only untagged file as the counterparty draft", () => {
    const result = assumeSingleCounterpartyDraft([card("S1", "context")]);
    expect(result.assumed?.id).toBe("S1");
    expect(result.cards[0]?.role).toBe("counterparty-draft");
  });

  it("does not guess when several files are still untagged", () => {
    const result = assumeSingleCounterpartyDraft([card("S1", "context"), card("S2", "context")]);
    expect(result.assumed).toBeNull();
    expect(result.cards.every((item) => item.role === "context")).toBe(true);
  });
});
