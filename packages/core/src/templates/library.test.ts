import { describe, expect, it } from "vitest";
import {
  TEMPLATE_LIBRARY,
  WORKSPACE_TEMPLATES,
  isWorkspaceTemplateId,
  libraryForMode,
  type LibraryMode,
} from "./library";

const MODES: LibraryMode[] = ["images", "videos", "documents", "research", "presentations"];

const EXPECTED_COUNTS: Record<LibraryMode, number> = {
  images: 10,
  videos: 6,
  documents: 6,
  research: 6,
  presentations: 6,
};

describe("TEMPLATE_LIBRARY", () => {
  it("seeds the expanded library by mode", () => {
    expect(TEMPLATE_LIBRARY).toHaveLength(34);
    for (const mode of MODES) {
      expect(libraryForMode(mode)).toHaveLength(EXPECTED_COUNTS[mode]);
    }
  });

  it("stays industry-neutral in seed copy", () => {
    const banned = /\b(student|course|campus)\b/i;
    for (const entry of TEMPLATE_LIBRARY) {
      expect(entry.title).not.toMatch(banned);
      expect(entry.prompt).not.toMatch(banned);
      expect(entry.resultSummary).not.toMatch(banned);
    }
  });

  it("libraryForMode returns only that mode", () => {
    for (const mode of MODES) {
      const entries = libraryForMode(mode);
      expect(entries.every((entry) => entry.mode === mode)).toBe(true);
    }
  });

  it("every entry has non-empty title, prompt, and resultSummary", () => {
    for (const entry of TEMPLATE_LIBRARY) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.prompt.trim().length).toBeGreaterThan(20);
      expect(entry.resultSummary.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("WORKSPACE_TEMPLATES", () => {
  it("exposes seven pack ids and accepts each", () => {
    expect(WORKSPACE_TEMPLATES.map((t) => t.id)).toEqual([
      "organisation",
      "students",
      "office",
      "legal",
      "sales",
      "marketing",
      "product",
    ]);
    for (const template of WORKSPACE_TEMPLATES) {
      expect(isWorkspaceTemplateId(template.id)).toBe(true);
      expect(template.label.trim().length).toBeGreaterThan(0);
      expect(template.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("rejects bogus ids", () => {
    expect(isWorkspaceTemplateId("campus")).toBe(false);
    expect(isWorkspaceTemplateId("")).toBe(false);
    expect(isWorkspaceTemplateId("Organisation")).toBe(false);
  });
});
