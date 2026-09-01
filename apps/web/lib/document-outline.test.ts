import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { parseDocumentDraft, parseDocumentDraftBody, mergeDocumentSection } from "./document-outline";
import { buildDocumentDocx } from "./document-docx";

const valid = {
  title: "Status memo",
  sections: [
    { heading: "Issue", body: "The vendor asked for a two-week extension.\n\nWe can grant it." },
    { heading: "Ask", body: "Approve the extension by Friday." },
  ],
};

describe("parseDocumentDraft", () => {
  it("accepts a valid draft string", () => {
    expect(parseDocumentDraft(JSON.stringify(valid))).toEqual(valid);
  });

  it("rejects missing sections", () => {
    expect(() => parseDocumentDraft(JSON.stringify({ title: "Empty", sections: [] }))).toThrow(ApiError);
  });
});

describe("parseDocumentDraftBody", () => {
  it("accepts a JSON body", () => {
    expect(parseDocumentDraftBody(valid).title).toBe("Status memo");
  });
});

describe("buildDocumentDocx", () => {
  it("returns a non-empty docx buffer", async () => {
    const { buffer, filename } = await buildDocumentDocx(valid);
    expect(filename).toBe("Status-memo.docx");
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });
});

describe("mergeDocumentSection", () => {
  it("replaces one section by index", () => {
    const next = mergeDocumentSection(valid, 1, { heading: "Ask", body: "New ask." });
    expect(next.sections[1]).toEqual({ heading: "Ask", body: "New ask." });
    expect(next.sections[0]).toEqual(valid.sections[0]);
  });
});
