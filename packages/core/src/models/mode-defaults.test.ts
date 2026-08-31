import { describe, expect, it } from "vitest";
import { pickPreferredJobModel, resolveModeDefaults } from "./mode-defaults";
import { DEFAULT_GATEWAY_IMAGE_MODEL, DEFAULT_GATEWAY_VIDEO_MODEL } from "./media-kind";

describe("pickPreferredJobModel", () => {
  it("picks the first preferred documents id that is live", () => {
    expect(pickPreferredJobModel("documents", ["gpt-5.6-sol", "kimi-k3", "glm-5.3"], "gpt-5.6-sol")).toBe(
      "kimi-k3",
    );
  });

  it("prefers DeepSeek for research when present", () => {
    expect(
      pickPreferredJobModel("research", ["glm-5.3", "deepseek-v4-pro", "gpt-5.6-sol"], "gpt-5.6-sol"),
    ).toBe("deepseek-v4-pro");
  });

  it("prefers gpt-5.6-sol for presentations when present", () => {
    expect(
      pickPreferredJobModel("presentations", ["kimi-k3", "gpt-5.6-sol", "claude-sonnet-5"], "kimi-k3"),
    ).toBe("gpt-5.6-sol");
  });

  it("falls back to the chat default when no hint is live", () => {
    expect(pickPreferredJobModel("documents", ["minimax-m3"], "minimax-m3")).toBe("minimax-m3");
  });
});

describe("resolveModeDefaults", () => {
  it("keeps chat default and routes media prefs independently", () => {
    const defaults = resolveModeDefaults({
      chatIds: ["gpt-5.6-sol", "claude-sonnet-5", "deepseek-v4-pro"],
      imageIds: ["mj_imagine", "gpt-image-2", "z-image-turbo"],
      videoIds: ["mj_video", "grok-imagine-video", "seedance-2.0-fast"],
      chatDefault: "gpt-5.6-sol",
    });
    expect(defaults.chat).toBe("gpt-5.6-sol");
    expect(defaults.documents).toBe("claude-sonnet-5");
    expect(defaults.research).toBe("deepseek-v4-pro");
    expect(defaults.presentations).toBe("gpt-5.6-sol");
    expect(defaults.image).toBe("gpt-image-2");
    expect(defaults.video).toBe("seedance-2.0-fast");
  });

  it("falls back to kernel media defaults when buckets are empty", () => {
    const defaults = resolveModeDefaults({
      chatIds: ["minimax-m3"],
      imageIds: [],
      videoIds: [],
      chatDefault: "minimax-m3",
    });
    expect(defaults.documents).toBe("minimax-m3");
    expect(defaults.research).toBe("minimax-m3");
    expect(defaults.presentations).toBe("minimax-m3");
    expect(defaults.image).toBe(DEFAULT_GATEWAY_IMAGE_MODEL);
    expect(defaults.video).toBe(DEFAULT_GATEWAY_VIDEO_MODEL);
  });
});
