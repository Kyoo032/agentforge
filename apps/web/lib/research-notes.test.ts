import { describe, expect, it } from "vitest";
import { parseResearchNotes, researchNotesToMarkdown } from "./research-notes";

const valid = {
  title: "Open-source licenses",
  summary: "Permissive licenses remain common for SaaS dependencies.",
  notes: [
    {
      heading: "MIT vs Apache",
      body: "Apache adds an explicit patent grant.",
      sources: [{ title: "OSI", url: "https://opensource.org" }],
    },
  ],
};

describe("parseResearchNotes", () => {
  it("accepts a valid notes string", () => {
    expect(parseResearchNotes(JSON.stringify(valid))).toEqual(valid);
  });

  it("defaults missing sources", () => {
    const parsed = parseResearchNotes(
      JSON.stringify({
        title: "A",
        summary: "B",
        notes: [{ heading: "H", body: "Body text" }],
      }),
    );
    expect(parsed.notes[0]?.sources).toEqual([]);
  });
});

describe("researchNotesToMarkdown", () => {
  it("includes headings and source URLs", () => {
    const md = researchNotesToMarkdown(valid);
    expect(md).toContain("# Open-source licenses");
    expect(md).toContain("https://opensource.org");
  });
});
