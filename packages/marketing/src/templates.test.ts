import { describe, expect, it } from "vitest";
import { marketingAgentPacks, marketingTemplates } from "./templates";

describe("marketing pack", () => {
  it("seeds campaign surfaces without campus or TokenKu copy", () => {
    expect(marketingAgentPacks).toHaveLength(1);
    expect(marketingAgentPacks[0]?.id).toBe("marketing");
    expect(marketingTemplates[0]?.productModes).toEqual([
      "chat",
      "documents",
      "images",
      "videos",
      "presentations",
    ]);
    expect(marketingTemplates[0]?.productModes).not.toContain("research");
    expect(marketingTemplates[0]?.productModes).not.toContain("agents");
    expect(marketingTemplates[0]?.toolKeys).toContain("image_generate");
    expect(marketingTemplates[0]?.toolKeys).toContain("video_generate");
    const blob = JSON.stringify(marketingTemplates);
    expect(blob).not.toMatch(/Harbor State/i);
    expect(blob).not.toMatch(/TokenKu/i);
    expect(blob).not.toMatch(/\bstudent\b/i);
    expect(blob).not.toMatch(/\bcourse\b/i);
  });
});
