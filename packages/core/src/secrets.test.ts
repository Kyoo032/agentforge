import { describe, expect, it } from "vitest";
import { maskSecrets, mergeSecrets, hasLiveProvider, resolveProviderKeys, resolveRuntimeMode } from "./secrets";
import { keyFingerprint } from "./security/fingerprint";
import { DEFAULT_OPENAI_BASE_URL } from "./models/probe";

describe("mergeSecrets", () => {
  it("sets a new key and leaves blank patches unchanged", () => {
    const merged = mergeSecrets(
      { openaiApiKey: "sk-old" },
      { openaiApiKey: "sk-new", googleApiKey: "  ", openaiBaseUrl: "https://openrouter.ai/api/v1/" },
    );
    expect(merged.openaiApiKey).toBe("sk-new");
    expect(merged.googleApiKey).toBeUndefined();
    expect(merged.openaiBaseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("stores tool keys separately from the chat model key", () => {
    const merged = mergeSecrets({ openaiApiKey: "sk-model" }, { toolKeys: { TAVILY_API_KEY: "tvly-test" } });
    expect(merged.openaiApiKey).toBe("sk-model");
    expect(merged.toolKeys).toEqual({ TAVILY_API_KEY: "tvly-test" });
  });

  it("clears an endpoint when the field is blank", () => {
    const merged = mergeSecrets({ openaiBaseUrl: "https://example.com/v1" }, { openaiBaseUrl: "  " });
    expect(merged.openaiBaseUrl).toBeUndefined();
  });

  it("clears a key field when the patch value is empty string", () => {
    const merged = mergeSecrets({ openaiApiKey: "sk-old" }, { openaiApiKey: "" });
    expect(merged.openaiApiKey).toBeUndefined();
  });

  it("clears a key field when the patch value is whitespace-only", () => {
    const merged = mergeSecrets({ openaiApiKey: "sk-old" }, { openaiApiKey: "   " });
    expect(merged.openaiApiKey).toBeUndefined();
  });

  it("clears a single tool key when patched with empty string", () => {
    const merged = mergeSecrets(
      { toolKeys: { TAVILY_API_KEY: "x", BRAVE_SEARCH_API_KEY: "y" } },
      { toolKeys: { TAVILY_API_KEY: "" } },
    );
    expect(merged.toolKeys?.TAVILY_API_KEY).toBeUndefined();
    expect(merged.toolKeys?.BRAVE_SEARCH_API_KEY).toBe("y");
  });

  it("clears all tool keys and removes toolKeys field when all are blanked", () => {
    const merged = mergeSecrets(
      { toolKeys: { TAVILY_API_KEY: "x" } },
      { toolKeys: { TAVILY_API_KEY: "" } },
    );
    expect(merged.toolKeys).toBeUndefined();
  });

  it("stores default image/video gen models and clears them on blank patch", () => {
    const set = mergeSecrets({}, { imageGenModel: "gpt-image-2", videoGenModel: "grok-imagine-video" });
    expect(set.imageGenModel).toBe("gpt-image-2");
    expect(set.videoGenModel).toBe("grok-imagine-video");
    const cleared = mergeSecrets(set, { imageGenModel: "  ", videoGenModel: "" });
    expect(cleared.imageGenModel).toBeUndefined();
    expect(cleared.videoGenModel).toBeUndefined();
  });

  it("stores document/research/presentation job models", () => {
    const set = mergeSecrets(
      {},
      { documentGenModel: "claude-sonnet-5", researchGenModel: "deepseek-v4-pro", presentationGenModel: "gpt-5.6-sol" },
    );
    expect(set.documentGenModel).toBe("claude-sonnet-5");
    expect(set.researchGenModel).toBe("deepseek-v4-pro");
    expect(set.presentationGenModel).toBe("gpt-5.6-sol");
  });

  it("replaces disabledTools when the patch includes the array", () => {
    const set = mergeSecrets({}, { disabledTools: ["image_generate", "web_search"] });
    expect(set.disabledTools).toEqual(["image_generate", "web_search"]);
    const emptied = mergeSecrets(set, { disabledTools: [] });
    expect(emptied.disabledTools).toEqual([]);
    const untouched = mergeSecrets(set, { openaiApiKey: "sk-x" });
    expect(untouched.disabledTools).toEqual(["image_generate", "web_search"]);
  });
});

describe("maskSecrets", () => {
  it("never returns the raw key", () => {
    expect(maskSecrets({ openaiApiKey: "sk-secret" }).openaiBaseUrl).toBe(DEFAULT_OPENAI_BASE_URL);
    expect(maskSecrets({ openaiApiKey: "sk-secret", openaiBaseUrl: "https://api.openai.com/v1" })).toEqual({
      hasOpenai: true,
      hasGoogle: false,
      hasAnthropic: false,
      hasVolcengine: false,
      openaiKeyFingerprint: keyFingerprint("sk-secret"),
      googleKeyFingerprint: null,
      anthropicKeyFingerprint: null,
      volcengineKeyFingerprint: null,
      openaiBaseUrl: "https://api.openai.com/v1",
      googleBaseUrl: undefined,
      anthropicBaseUrl: undefined,
      volcengineBaseUrl: undefined,
      hasToolKeys: {
        TAVILY_API_KEY: false,
        TAVILY_BASE_URL: false,
        BRAVE_SEARCH_API_KEY: false,
        FAL_KEY: false,
      },
      toolBackends: {},
      imageGenModel: undefined,
      videoGenModel: undefined,
      documentGenModel: undefined,
      researchGenModel: undefined,
      presentationGenModel: undefined,
      disabledTools: [],
    });
  });

  it("exposes sha256 fingerprints and never embeds the raw keys in JSON", () => {
    const secrets = {
      openaiApiKey: "sk-secret",
      googleApiKey: "google-secret",
      anthropicApiKey: "sk-ant-secret",
      volcengineApiKey: "ark-secret",
    };
    const masked = maskSecrets(secrets);
    expect(masked.openaiKeyFingerprint).toBe(keyFingerprint("sk-secret"));
    expect(masked.googleKeyFingerprint).toBe(keyFingerprint("google-secret"));
    expect(masked.anthropicKeyFingerprint).toBe(keyFingerprint("sk-ant-secret"));
    expect(masked.volcengineKeyFingerprint).toBe(keyFingerprint("ark-secret"));
    expect(masked.openaiKeyFingerprint).toMatch(/^sha256:[0-9a-f]{12}$/);
    const json = JSON.stringify(masked);
    expect(json).not.toContain("sk-secret");
    expect(json).not.toContain("google-secret");
    expect(json).not.toContain("sk-ant-secret");
    expect(json).not.toContain("ark-secret");
  });

  it("returns null fingerprints when no provider keys are saved", () => {
    const masked = maskSecrets({});
    expect(masked.openaiKeyFingerprint).toBeNull();
    expect(masked.googleKeyFingerprint).toBeNull();
    expect(masked.anthropicKeyFingerprint).toBeNull();
    expect(masked.volcengineKeyFingerprint).toBeNull();
  });

  it("masks tool keys without returning them", () => {
    expect(maskSecrets({ toolKeys: { TAVILY_API_KEY: "tvly-secret" }, toolBackends: { web: "tavily" } }).hasToolKeys).toEqual(
      expect.objectContaining({ TAVILY_API_KEY: true, BRAVE_SEARCH_API_KEY: false }),
    );
    expect(JSON.stringify(maskSecrets({ toolKeys: { TAVILY_API_KEY: "tvly-secret" } }))).not.toContain("tvly-secret");
  });

  it("returns image/video models and disabledTools for Settings round-trip", () => {
    const masked = maskSecrets({
      imageGenModel: "gpt-image-2",
      videoGenModel: "grok-imagine-video",
      documentGenModel: "claude-sonnet-5",
      disabledTools: ["calculator"],
    });
    expect(masked.imageGenModel).toBe("gpt-image-2");
    expect(masked.videoGenModel).toBe("grok-imagine-video");
    expect(masked.documentGenModel).toBe("claude-sonnet-5");
    expect(masked.disabledTools).toEqual(["calculator"]);
  });
});

describe("resolveRuntimeMode", () => {
  it("uses live models once the owner saved a key", () => {
    expect(resolveRuntimeMode({ settingsHasKey: true, envRuntime: "stub" })).toBe("ai");
    expect(resolveRuntimeMode({ settingsHasKey: false, envRuntime: "stub" })).toBe("stub");
  });
});

describe("resolveProviderKeys", () => {
  it("prefers settings over env", () => {
    const keys = resolveProviderKeys(
      { openaiApiKey: "from-settings" },
      { OPENAI_API_KEY: "from-env" } as NodeJS.ProcessEnv,
    );
    expect(keys.openai).toBe("from-settings");
    expect(keys.openaiBaseUrl).toBe(DEFAULT_OPENAI_BASE_URL);
  });

  it("defaults the OpenAI-compatible endpoint to Toko Token", () => {
    const keys = resolveProviderKeys({}, {} as NodeJS.ProcessEnv);
    expect(keys.openaiBaseUrl).toBe("https://api.tokotokenai.com/v1");
  });

  it("reuses the OpenAI-compatible field when auto-detect finds another dialect", () => {
    const anthropic = resolveProviderKeys({ openaiApiKey: "sk-ant-test" }, {} as NodeJS.ProcessEnv);
    expect(anthropic.anthropic).toBe("sk-ant-test");

    const ark = resolveProviderKeys(
      { openaiApiKey: "ark-key", openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
      {} as NodeJS.ProcessEnv,
    );
    expect(ark.volcengine).toBe("ark-key");
    expect(ark.volcengineBaseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
  });
});

describe("hasLiveProvider", () => {
  it("treats a custom endpoint as enough to leave stub mode", () => {
    expect(hasLiveProvider({ openaiBaseUrl: "http://127.0.0.1:11434/v1" })).toBe(true);
    expect(hasLiveProvider({ anthropicApiKey: "sk-ant-test" })).toBe(true);
    expect(hasLiveProvider({})).toBe(false);
    expect(hasLiveProvider({ openaiBaseUrl: DEFAULT_OPENAI_BASE_URL })).toBe(false);
    expect(hasLiveProvider({ openaiApiKey: "sk-test" })).toBe(true);
  });
});
