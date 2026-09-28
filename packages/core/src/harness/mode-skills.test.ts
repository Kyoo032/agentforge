import { describe, expect, it } from "vitest";
import { PRODUCT_MODE_IDS } from "../agents/product-modes";
import { MODE_HARNESSES, harnessFor, wiredSkillIds } from "./mode-skills";

describe("mode harnesses", () => {
  it("packs five skills for every live mode, plus knowledge and education", () => {
    expect(MODE_HARNESSES.map((harness) => harness.id)).toEqual([...PRODUCT_MODE_IDS, "knowledge"]);
    for (const harness of MODE_HARNESSES) {
      expect(harness.skills, harness.id).toHaveLength(5);
    }
  });

  it("wires only the skills the list marked new", () => {
    expect(wiredSkillIds()).toEqual([
      "chat:ground-in-desk",
      "chat:say-the-result",
      "chat:look-not-make",
      "documents:check-against-source",
      "presentations:edit-text",
      "presentations:add-shapes",
      "education:teaching-deck",
      "education:edit-text-and-shapes",
      "education:exam-from-knowledge",
      "education:book-reader",
      "education:video-presenter",
    ]);
    expect(harnessFor("music")?.skills.find((skill) => skill.id === "speak-text")?.status).toBe("off");
    expect(harnessFor("chat")?.skills.map((skill) => skill.status)).toEqual(["has", "new", "new", "new", "has"]);
  });

  it("keeps campus nouns out of the catalog", () => {
    expect(JSON.stringify(MODE_HARNESSES)).not.toMatch(/\bstudent\b|\bcourse\b|\bcampus\b/i);
  });
});
