import { describe, expect, it } from "vitest";
import {
  EFFECTIVE_JOB_MODEL,
  JOB_MODE_PREFERENCES,
  pickPreferredJobModel,
  resolveModeDefaults,
} from "./mode-defaults";
import { DEFAULT_GATEWAY_IMAGE_MODEL, DEFAULT_GATEWAY_VIDEO_MODEL } from "./media-kind";

/** Every list, as the owner set them on 2026-09-30 (prices from /api/pricing, latency from the probe). */
describe("JOB_MODE_PREFERENCES", () => {
  it("holds the lists of 2026-09-30 exactly", () => {
    expect(JOB_MODE_PREFERENCES).toEqual({
      documents: ["hy3", "deepseek-v4-1-flash", "deepseek-v4-flash"],
      research: ["gpt-6-luna", "gpt-6-sol", "gpt-5.6-luna", "MiniMax-M3", "minimax-m3"],
      presentations: ["glm-5.3-flash", "claude-sonnet-5-5", "glm-5.3", "kimi-k3"],
      finance: ["hy3", "deepseek-v4-1-flash", "deepseek-v4-flash"],
      data: ["gpt-6-luna", "gpt-6-sol", "gpt-5.6-luna", "MiniMax-M3", "minimax-m3"],
      market: ["hy3", "deepseek-v4-1-flash", "deepseek-v4-flash"],
      legal: ["gpt-6-sol", "claude-sonnet-5-5", "gpt-5.6-sol", "kimi-k3"],
      meeting: ["gpt-6-sol", "claude-sonnet-5-5", "gemini-3.5-flash", "gpt-5.6-sol"],
    });
  });

  it("names the id the three DeepSeek-backed modes now resolve to, and it is the head of each", () => {
    expect(EFFECTIVE_JOB_MODEL).toBe("hy3");
    for (const mode of ["documents", "finance", "market"] as const) {
      expect(JOB_MODE_PREFERENCES[mode][0], mode).toBe(EFFECTIVE_JOB_MODEL);
    }
  });

  it("no longer lists the hy-3 and hunyuan spellings the gateway never served", () => {
    const all = Object.values(JOB_MODE_PREFERENCES).flat();
    for (const gone of ["hy-3", "hunyuan-3", "hunyuan3"]) {
      expect(all, gone).not.toContain(gone);
    }
  });
});

describe("pickPreferredJobModel", () => {
  it("picks hy3 for documents when it is live, as it is on the gateway (probe 2026-09-30)", () => {
    expect(pickPreferredJobModel("documents", ["hy3", "deepseek-v4-1-flash", "deepseek-v4-flash"], "gpt-6-luna")).toBe(
      "hy3",
    );
  });

  it("picks DeepSeek V4.1 Flash for documents when hy3 is absent, then V4 Flash", () => {
    expect(
      pickPreferredJobModel("documents", ["gpt-6-sol", "kimi-k3", "deepseek-v4-1-flash", "deepseek-v4-flash"], "gpt-6-sol"),
    ).toBe("deepseek-v4-1-flash");
    expect(pickPreferredJobModel("documents", ["gpt-6-sol", "kimi-k3", "deepseek-v4-flash", "glm-5.3"], "gpt-6-sol")).toBe(
      "deepseek-v4-flash",
    );
  });

  it("prefers GPT 6 Luna for research and data when present, then GPT 6 Sol", () => {
    const live = ["glm-5.3", "deepseek-v4-pro", "gpt-5.6-terra", "gpt-6-sol", "gpt-6-luna", "MiniMax-M3"];
    expect(pickPreferredJobModel("research", live, "gpt-6-sol")).toBe("gpt-6-luna");
    expect(pickPreferredJobModel("data", live, "gpt-6-sol")).toBe("gpt-6-luna");
    expect(pickPreferredJobModel("research", live.filter((id) => id !== "gpt-6-luna"), "kimi-k3")).toBe("gpt-6-sol");
  });

  it("falls to GPT 5.6 Luna and then MiniMax M3 for research when GPT 6 is absent", () => {
    expect(pickPreferredJobModel("research", ["gpt-5.6-luna", "MiniMax-M3"], "kimi-k3")).toBe("gpt-5.6-luna");
    expect(pickPreferredJobModel("research", ["glm-5.3", "deepseek-v4-pro", "gpt-5.6-terra", "MiniMax-M3"], "kimi-k3")).toBe(
      "MiniMax-M3",
    );
  });

  it("prefers GLM 5.3 Flash for presentations when live, ahead of Claude Sonnet 5.5 and Kimi K3", () => {
    expect(
      pickPreferredJobModel(
        "presentations",
        ["kimi-k3", "gpt-6-sol", "claude-sonnet-5-5", "glm-5.3-flash", "glm-5.3"],
        "kimi-k3",
      ),
    ).toBe("glm-5.3-flash");
    expect(pickPreferredJobModel("presentations", ["kimi-k3", "claude-sonnet-5-5", "glm-5.3"], "kimi-k3")).toBe(
      "claude-sonnet-5-5",
    );
  });

  it("prefers GPT 6 Sol for legal and for meeting minutes, then Claude Sonnet 5.5", () => {
    const live = ["kimi-k3", "gpt-5.6-sol", "claude-sonnet-5-5", "gpt-6-sol", "gemini-3.5-flash"];
    expect(pickPreferredJobModel("legal", live, "kimi-k3")).toBe("gpt-6-sol");
    expect(pickPreferredJobModel("meeting", live, "kimi-k3")).toBe("gpt-6-sol");
    const withoutSix = live.filter((id) => id !== "gpt-6-sol");
    expect(pickPreferredJobModel("legal", withoutSix, "kimi-k3")).toBe("claude-sonnet-5-5");
    expect(pickPreferredJobModel("meeting", withoutSix, "kimi-k3")).toBe("claude-sonnet-5-5");
  });

  it("falls back to the chat default when no hint is live", () => {
    expect(pickPreferredJobModel("documents", ["minimax-m3"], "minimax-m3")).toBe("minimax-m3");
  });
});

describe("resolveModeDefaults", () => {
  it("keeps chat default and routes media prefs independently", () => {
    const defaults = resolveModeDefaults({
      chatIds: [
        "gpt-6-luna",
        "gpt-6-sol",
        "gpt-5.6-luna",
        "claude-sonnet-5-5",
        "deepseek-v4-1-flash",
        "deepseek-v4-flash",
        "hy3",
        "glm-5.3-flash",
      ],
      imageIds: ["mj_imagine", "gpt-image-2", "seedream-5.0-pro", "z-image-turbo"],
      videoIds: ["mj_video", "grok-imagine-video", "seedance-2.5", "seedance-2.0"],
      embeddingIds: ["text-embedding-3-small", "text-embedding-3-large"],
      chatDefault: "gpt-6-luna",
    });
    expect(defaults.chat).toBe("gpt-6-luna");
    expect(defaults.documents).toBe("hy3");
    expect(defaults.research).toBe("gpt-6-luna");
    expect(defaults.presentations).toBe("glm-5.3-flash");
    expect(defaults.finance).toBe("hy3");
    expect(defaults.data).toBe("gpt-6-luna");
    expect(defaults.market).toBe("hy3");
    expect(defaults.legal).toBe("gpt-6-sol");
    expect(defaults.meeting).toBe("gpt-6-sol");
    expect(defaults.legalVerifier).toBe("gpt-6-luna");
    expect(defaults.image).toBe("gpt-image-2");
    expect(defaults.video).toBe("seedance-2.0");
    expect(defaults.embedding).toBe("text-embedding-3-small");
    expect(defaults.knowledgeBrain).toBe("gpt-6-luna");
    expect(defaults.knowledgeVerifier).toBe("gpt-6-luna");
  });

  it("lands Documents, Finance and Market on DeepSeek V4.1 Flash while hy3 is not listed", () => {
    const defaults = resolveModeDefaults({
      chatIds: ["gpt-6-luna", "deepseek-v4-1-flash", "deepseek-v4-flash"],
      imageIds: [],
      videoIds: [],
      chatDefault: "gpt-6-luna",
    });
    expect(defaults.documents).toBe("deepseek-v4-1-flash");
    expect(defaults.finance).toBe("deepseek-v4-1-flash");
    expect(defaults.market).toBe("deepseek-v4-1-flash");
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
    expect(defaults.market).toBe("minimax-m3");
    expect(defaults.legal).toBe("minimax-m3");
    expect(defaults.legalVerifier).toBe("minimax-m3");
    expect(defaults.image).toBe(DEFAULT_GATEWAY_IMAGE_MODEL);
    expect(defaults.video).toBe(DEFAULT_GATEWAY_VIDEO_MODEL);
    expect(defaults.embedding).toBe("text-embedding-3-small");
    expect(defaults.knowledgeBrain).toBe("minimax-m3");
    expect(defaults.knowledgeVerifier).toBe("minimax-m3");
  });
});
