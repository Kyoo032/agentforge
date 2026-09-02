import { describe, expect, it } from "vitest";
import {
  TEMPLATE_LIBRARY,
  WORKSPACE_TEMPLATES,
  isWorkspaceTemplateId,
  libraryForMode,
  productModesForTemplate,
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
      expect(entry.prompt.trim().length).toBeGreaterThan(240);
      expect(entry.resultSummary.trim().length).toBeGreaterThan(20);
    }
  });

  it("writing templates are briefs with audience and deliverable", () => {
    for (const mode of ["documents", "research", "presentations"] as const) {
      for (const entry of libraryForMode(mode)) {
        expect(entry.prompt.length).toBeGreaterThan(500);
        expect(entry.prompt).toMatch(/Audience|Deliverable|Method/i);
        expect(entry.prompt).not.toMatch(/one sentence per slide/i);
        expect(entry.prompt).toMatch(/Quality bar:/i);
      }
    }
  });
});

describe("WORKSPACE_TEMPLATES", () => {
  it("exposes pack ids with productModes and accepts each", () => {
    expect(WORKSPACE_TEMPLATES.map((t) => t.id)).toEqual([
      "general",
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
      expect(template.productModes.length).toBeGreaterThan(0);
      expect(template.productModes[0]).toBe("chat");
    }
  });

  it("rejects bogus ids", () => {
    expect(isWorkspaceTemplateId("campus")).toBe(false);
    expect(isWorkspaceTemplateId("")).toBe(false);
    expect(isWorkspaceTemplateId("Organisation")).toBe(false);
  });

  it("maps preset ids to productModes and blank to chat", () => {
    expect(productModesForTemplate(null)).toEqual(["chat"]);
    expect(productModesForTemplate("legal")).toEqual(["chat", "documents", "research", "presentations"]);
    expect(productModesForTemplate("general")[0]).toBe("chat");
    expect(productModesForTemplate("general")).toContain("videos");
  });
});
