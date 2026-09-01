import { describe, expect, it } from "vitest";
import {
  TEMPLATE_LIBRARY,
  WORKSPACE_TEMPLATES,
  isWorkspaceTemplateId,
  libraryForMode,
  type LibraryMode,
} from "./library";

const MODES: LibraryMode[] = ["images", "videos", "documents", "research", "presentations"];

describe("TEMPLATE_LIBRARY", () => {
  it("seeds three realistic entries per mode", () => {
    expect(TEMPLATE_LIBRARY).toHaveLength(15);
    for (const mode of MODES) {
      expect(libraryForMode(mode)).toHaveLength(3);
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
