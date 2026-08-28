import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_MODEL, DEFAULT_CHAT_TOOLS } from "./default-chat";
import { DEFAULT_PACK_ID, DEFAULT_TEMPLATE_KEY, defaultAgentPack, defaultAgentTemplate } from "./default-template";
import { LEGACY_PRODUCT_MODES } from "./product-modes";

describe("default agent pack", () => {
  it("is a kernel starter, not a campus template", () => {
    expect(defaultAgentPack.id).toBe(DEFAULT_PACK_ID);
    expect(defaultAgentPack.templates).toEqual([defaultAgentTemplate]);
    expect(defaultAgentTemplate.key).toBe(DEFAULT_TEMPLATE_KEY);
    expect(defaultAgentTemplate.name).toBe("Assistant");
    expect(defaultAgentTemplate.model).toBe(DEFAULT_CHAT_MODEL);
    expect(defaultAgentTemplate.toolKeys).toEqual([...DEFAULT_CHAT_TOOLS]);
    expect(defaultAgentTemplate.productModes).toEqual(LEGACY_PRODUCT_MODES);
    expect(JSON.stringify(defaultAgentPack)).not.toMatch(/office hours/i);
    expect(JSON.stringify(defaultAgentPack)).not.toMatch(/Harbor State/i);
  });
});
