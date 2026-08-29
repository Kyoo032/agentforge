import { describe, expect, it } from "vitest";
import { agentPacks, universityTemplates } from "./templates";

describe("agent packs", () => {
  it("offers Students as an optional starter, not a required chat agent", () => {
    expect(agentPacks).toHaveLength(1);
    expect(agentPacks[0]?.id).toBe("students");
    expect(universityTemplates).toHaveLength(1);
    expect(universityTemplates[0]?.name).toBe("Student");
    expect(universityTemplates[0]?.productModes).toEqual([
      "chat",
      "documents",
      "research",
      "images",
      "presentations",
    ]);
    expect(universityTemplates[0]?.productModes).not.toContain("videos");
    expect(universityTemplates[0]?.productModes).not.toContain("agents");
    const blob = JSON.stringify(universityTemplates);
    expect(blob).not.toMatch(/Harbor State/i);
    expect(blob).not.toMatch(/Course Tutor/i);
    expect(blob).not.toMatch(/TokenKu/i);
  });
});
