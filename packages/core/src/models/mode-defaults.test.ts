import { describe, expect, it } from "vitest";
import { pickPreferredJobModel, resolveModeDefaults } from "./mode-defaults";
import { DEFAULT_GATEWAY_IMAGE_MODEL, DEFAULT_GATEWAY_VIDEO_MODEL } from "./media-kind";

describe("pickPreferredJobModel", () => {
  it("picks DeepSeek V4 Flash for documents when hy3 is absent", () => {
    expect(
      pickPreferredJobModel("documents", ["gpt-5.6-sol", "kimi-k3", "deepseek-v4-flash", "glm-5.3"], "gpt-5.6-sol"),
    ).toBe("deepseek-v4-flash");
  });

  it("picks hy3 for documents when it is live", () => {
    expect(pickPreferredJobModel("documents", ["hy3", "deepseek-v4-flash"], "gpt-5.6-luna")).toBe("hy3");
  });

  it("prefers GPT-5.6 Luna for research when present", () => {
    expect(
      pickPreferredJobModel("research", ["glm-5.3", "deepseek-v4-pro", "gpt-5.6-luna", "MiniMax-M3"], "gpt-5.6-sol"),
    ).toBe("gpt-5.6-luna");
  });

  it("prefers GLM 5.2 Fast for presentations when live, ahead of Kimi K3", () => {
    expect(
      pickPreferredJobModel(
        "presentations",
        ["kimi-k3", "gpt-5.6-sol", "glm-5.2-fast-preview", "claude-sonnet-5"],
        "kimi-k3",
      ),
    ).toBe("glm-5.2-fast-preview");
  });

  it("falls back to the chat default when no hint is live", () => {
    expect(pickPreferredJobModel("documents", ["minimax-m3"], "minimax-m3")).toBe("minimax-m3");
  });
});

describe("resolveModeDefaults", () => {
  it("keeps chat default and routes media prefs independently", () => {
    const defaults = resolveModeDefaults({
      chatIds: ["gpt-5.6-luna", "gpt-5.6-sol", "claude-sonnet-5", "deepseek-v4-flash", "glm-5.2-fast-preview"],
      imageIds: ["mj_imagine", "gpt-image-2", "seedream-5.0-pro", "z-image-turbo"],
      videoIds: ["mj_video", "grok-imagine-video", "seedance-2.5", "seedance-2.0-fast"],
      embeddingIds: ["text-embedding-3-small", "text-embedding-3-large"],
      chatDefault: "gpt-5.6-luna",
    });
    expect(defaults.chat).toBe("gpt-5.6-luna");
    expect(defaults.documents).toBe("deepseek-v4-flash");
    expect(defaults.research).toBe("gpt-5.6-luna");
    expect(defaults.presentations).toBe("glm-5.2-fast-preview");
    expect(defaults.finance).toBe("deepseek-v4-flash");
    expect(defaults.data).toBe("gpt-5.6-luna");
    expect(defaults.legal).toBe("gpt-5.6-sol");
    expect(defaults.legalVerifier).toBe("gpt-5.6-luna");
    expect(defaults.image).toBe("gpt-image-2");
    expect(defaults.video).toBe("grok-imagine-video");
    expect(defaults.embedding).toBe("text-embedding-3-small");
    expect(defaults.knowledgeBrain).toBe("gpt-5.6-luna");
    expect(defaults.knowledgeVerifier).toBe("gpt-5.6-luna");
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
    expect(defaults.finance).toBe("minimax-m3");
    expect(defaults.data).toBe("minimax-m3");
    expect(defaults.legal).toBe("minimax-m3");
    expect(defaults.legalVerifier).toBe("minimax-m3");
    expect(defaults.image).toBe(DEFAULT_GATEWAY_IMAGE_MODEL);
    expect(defaults.video).toBe(DEFAULT_GATEWAY_VIDEO_MODEL);
    expect(defaults.embedding).toBe("text-embedding-3-small");
    expect(defaults.knowledgeBrain).toBe("minimax-m3");
    expect(defaults.knowledgeVerifier).toBe("minimax-m3");
  });
});
