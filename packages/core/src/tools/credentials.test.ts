import { describe, expect, it } from "vitest";
import { buildToolSecretScope, resolveToolBackend, secretMapFromSettings } from "./credentials";
import { getDisabledTools, getInjectionGuardBypass, runWithToolSecrets } from "./secret-scope";

describe("resolveToolBackend", () => {
  it("keeps a stored selection even when another vendor key is present", () => {
    const route = resolveToolBackend("web", {
      selection: "brave-free",
      secrets: { TAVILY_API_KEY: "tvly-test", BRAVE_SEARCH_API_KEY: "bsa-test" },
    });
    expect(route).toMatchObject({ backend: "brave-free", source: "selection", ready: true, envVar: "BRAVE_SEARCH_API_KEY" });
  });

  it("does not silently reroute when the selected key is missing", () => {
    const route = resolveToolBackend("web", {
      selection: "tavily",
      secrets: { BRAVE_SEARCH_API_KEY: "bsa-test" },
    });
    expect(route).toMatchObject({ backend: "tavily", source: "selection", ready: false });
  });

  it("autodects Tavily then Brave only when nothing was selected", () => {
    expect(
      resolveToolBackend("web", { selection: "", secrets: { BRAVE_SEARCH_API_KEY: "bsa-test" } }),
    ).toMatchObject({ backend: "brave-free", source: "autodetect", ready: true });
    expect(
      resolveToolBackend("web", { selection: "", secrets: { TAVILY_API_KEY: "tvly-test", BRAVE_SEARCH_API_KEY: "bsa-test" } }),
    ).toMatchObject({ backend: "tavily", source: "autodetect", ready: true });
  });

  it("does not treat a chat/inference key as a web backend", () => {
    const route = resolveToolBackend("web", {
      selection: "",
      secrets: { OPENAI_API_KEY: "sk-test", XAI_API_KEY: "xai-test", ANTHROPIC_API_KEY: "sk-ant-test" },
    });
    expect(route.ready).toBe(false);
    expect(route.source).toBe("autodetect");
  });

  it("autodects image_gen from the gateway chat key, then FAL", () => {
    expect(
      resolveToolBackend("image_gen", { selection: "", secrets: { OPENAI_API_KEY: "sk-test" } }),
    ).toMatchObject({ backend: "gateway", source: "autodetect", ready: true, envVar: "OPENAI_API_KEY" });
    expect(
      resolveToolBackend("image_gen", {
        selection: "",
        secrets: { FAL_KEY: "fal-test", OPENAI_API_KEY: "sk-test" },
      }),
    ).toMatchObject({ backend: "gateway", source: "autodetect", ready: true, envVar: "OPENAI_API_KEY" });
    expect(
      resolveToolBackend("image_gen", { selection: "", secrets: { FAL_KEY: "fal-test" } }),
    ).toMatchObject({ backend: "fal", source: "autodetect", ready: true, envVar: "FAL_KEY" });
  });

  it("reuses the chat OpenAI key for image_gen only after that backend is selected", () => {
    const route = resolveToolBackend("image_gen", {
      selection: "openai",
      secrets: { OPENAI_API_KEY: "sk-test", FAL_KEY: "fal-test" },
    });
    expect(route).toMatchObject({
      backend: "openai",
      source: "selection",
      ready: true,
      envVar: "OPENAI_API_KEY",
    });
  });

  it("does not silently fall from FAL image_gen to OpenAI when FAL_KEY is missing", () => {
    const route = resolveToolBackend("image_gen", {
      selection: "fal",
      secrets: { OPENAI_API_KEY: "sk-test" },
    });
    expect(route).toMatchObject({ backend: "fal", source: "selection", ready: false });
  });

  it("autodects video_gen from the gateway chat key, then FAL, and ignores the Ark key", () => {
    expect(
      resolveToolBackend("video_gen", { selection: "", secrets: { OPENAI_API_KEY: "sk-test" } }),
    ).toMatchObject({ backend: "gateway", source: "autodetect", ready: true, envVar: "OPENAI_API_KEY" });
    expect(
      resolveToolBackend("video_gen", { selection: "", secrets: { ARK_API_KEY: "ark-test" } }),
    ).toMatchObject({ backend: "gateway", source: "autodetect", ready: false });
    expect(
      resolveToolBackend("video_gen", { selection: "", secrets: { FAL_KEY: "fal-test" } }),
    ).toMatchObject({ backend: "fal", source: "autodetect", ready: true, envVar: "FAL_KEY" });
  });

  it("reuses the Ark key for video_gen only after Seedance is selected", () => {
    const route = resolveToolBackend("video_gen", {
      selection: "volcengine",
      secrets: { ARK_API_KEY: "ark-test", FAL_KEY: "fal-test" },
    });
    expect(route).toMatchObject({
      backend: "volcengine",
      source: "selection",
      ready: true,
      envVar: "ARK_API_KEY",
    });
  });
});

describe("secretMapFromSettings", () => {
  it("keeps tool keys off the OpenAI-compatible model field", () => {
    const map = secretMapFromSettings(
      { openaiApiKey: "sk-model", toolKeys: { TAVILY_API_KEY: "tvly-test" } },
      {} as NodeJS.ProcessEnv,
    );
    expect(map.OPENAI_API_KEY).toBe("sk-model");
    expect(map.TAVILY_API_KEY).toBe("tvly-test");
  });

  it("carries the OpenAI endpoint so image_generate can reuse it", () => {
    const map = secretMapFromSettings(
      { openaiApiKey: "sk-model", openaiBaseUrl: "https://gateway.example/v1", toolKeys: { FAL_KEY: "fal-test" } },
      {} as NodeJS.ProcessEnv,
    );
    expect(map.OPENAI_BASE_URL).toBe("https://gateway.example/v1");
    expect(map.FAL_KEY).toBe("fal-test");
  });

  it("includes IMAGE_GEN_MODEL and VIDEO_GEN_MODEL from settings or env", () => {
    const fromSettings = secretMapFromSettings(
      { imageGenModel: "gpt-image-2", videoGenModel: "grok-imagine-video" },
      {} as NodeJS.ProcessEnv,
    );
    expect(fromSettings.IMAGE_GEN_MODEL).toBe("gpt-image-2");
    expect(fromSettings.VIDEO_GEN_MODEL).toBe("grok-imagine-video");

    const fromEnv = secretMapFromSettings({}, {
      IMAGE_GEN_MODEL: "env-image",
      VIDEO_GEN_MODEL: "env-video",
    } as NodeJS.ProcessEnv);
    expect(fromEnv.IMAGE_GEN_MODEL).toBe("env-image");
    expect(fromEnv.VIDEO_GEN_MODEL).toBe("env-video");
  });
});

describe("buildToolSecretScope / getDisabledTools", () => {
  it("copies disabledTools into the ALS scope", () => {
    expect(getDisabledTools()).toEqual([]);
    const scope = buildToolSecretScope(
      { disabledTools: ["image_generate", "web_search"] },
      {} as NodeJS.ProcessEnv,
    );
    expect(scope.disabledTools).toEqual(["image_generate", "web_search"]);
    runWithToolSecrets(scope, () => {
      expect(getDisabledTools()).toEqual(["image_generate", "web_search"]);
    });
    expect(getDisabledTools()).toEqual([]);
  });

  it("copies injectionGuardBypass into the ALS scope (default false)", () => {
    expect(getInjectionGuardBypass()).toBe(false);
    const protectedScope = buildToolSecretScope({}, {} as NodeJS.ProcessEnv);
    expect(protectedScope.injectionGuardBypass).toBe(false);
    const open = buildToolSecretScope({ injectionGuardBypass: true }, {} as NodeJS.ProcessEnv);
    runWithToolSecrets(open, () => {
      expect(getInjectionGuardBypass()).toBe(true);
    });
    expect(getInjectionGuardBypass()).toBe(false);
  });
});
