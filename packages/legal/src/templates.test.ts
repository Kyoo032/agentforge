import { describe, expect, it } from "vitest";
import { legalAgentPacks, legalTemplates } from "./templates";

describe("legal pack", () => {
  it("seeds document and research surfaces without image or video tabs", () => {
    expect(legalAgentPacks).toHaveLength(1);
    expect(legalAgentPacks[0]?.id).toBe("legal");
    expect(legalTemplates[0]?.productModes).toEqual(["chat", "documents", "research", "legal", "presentations"]);
    expect(legalTemplates[0]?.productModes).not.toContain("images");
    expect(legalTemplates[0]?.productModes).not.toContain("videos");
    expect(legalTemplates[0]?.productModes).not.toContain("agents");
    expect(legalTemplates[0]?.toolKeys).toContain("web_search");
    const blob = JSON.stringify(legalTemplates);
    expect(blob).not.toMatch(/Harbor State/i);
    expect(blob).not.toMatch(/TokenKu/i);
    expect(blob).not.toMatch(/\bstudent\b/i);
    expect(blob).not.toMatch(/\bcourse\b/i);
  });
});
