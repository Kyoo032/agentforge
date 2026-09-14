import { describe, expect, it } from "vitest";
import { parseDocumentDraftBody } from "./document-outline";
import { parsePresentationOutlineBody } from "./presentation-outline";
import { DOCUMENT_STARTERS, PRESENTATION_STARTERS, presentationStarters } from "./job-starters";

describe("job starters", () => {
  it("ships valid document drafts", () => {
    expect(DOCUMENT_STARTERS).toHaveLength(2);
    for (const starter of DOCUMENT_STARTERS) {
      expect(parseDocumentDraftBody(starter.draft).title).toBe(starter.draft.title);
    }
  });

  it("ships valid presentation outlines in en and id", () => {
    expect(PRESENTATION_STARTERS).toHaveLength(2);
    for (const starter of PRESENTATION_STARTERS) {
      expect(parsePresentationOutlineBody(starter.outline).title).toBe(starter.outline.title);
    }
    const idStarters = presentationStarters("id");
    expect(idStarters).toHaveLength(2);
    expect(idStarters[0]?.label).toBe("Pembaruan proyek");
    for (const starter of idStarters) {
      expect(parsePresentationOutlineBody(starter.outline).title).toBe(starter.outline.title);
    }
  });
});
