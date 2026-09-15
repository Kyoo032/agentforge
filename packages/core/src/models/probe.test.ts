import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import {
  DEFAULT_OPENAI_BASE_URL,
  detectCompatibleApi,
  guessDialectFromKey,
  guessDialectFromUrl,
  isChatModelId,
  isDefaultOpenAIBaseUrl,
  isOfficialOpenAIBaseUrl,
  modelsFromAnthropicList,
  modelsFromGoogleList,
  modelsFromOpenAIList,
  normalizeProviderBaseUrl,
  probeGoogleModels,
  probeOpenAIModels,
  resolvedOpenAIBaseUrl,
} from "./probe";

describe("normalizeProviderBaseUrl", () => {
  it("adds /v1 onto a host-only OpenAI URL", () => {
    expect(normalizeProviderBaseUrl("https://api.openai.com", "openai")).toBe("https://api.openai.com/v1");
    expect(normalizeProviderBaseUrl("https://openrouter.ai/api", "openai")).toBe("https://openrouter.ai/api/v1");
  });

  it("keeps an explicit path", () => {
    expect(normalizeProviderBaseUrl("http://127.0.0.1:11434/v1/", "openai")).toBe("http://127.0.0.1:11434/v1");
  });

  it("uses Ark /api/v3 for Volcengine hosts", () => {
    expect(normalizeProviderBaseUrl("https://ark.cn-beijing.volces.com", "openai")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3",
    );
  });

  it("rejects a non-url", () => {
    try {
      normalizeProviderBaseUrl("not a url", "openai");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("invalid_endpoint");
    }
  });

  it("rejects plain http for remote hosts", () => {
    try {
      normalizeProviderBaseUrl("http://api.tokotokenai.com/v1", "openai");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("invalid_endpoint");
    }
  });

  it("accepts plain http for loopback (Ollama)", () => {
    expect(normalizeProviderBaseUrl("http://127.0.0.1:11434/v1", "openai")).toBe("http://127.0.0.1:11434/v1");
  });
});

describe("modelsFromOpenAIList", () => {
  it("keeps generate ids and still drops nothing from the OpenAI-compatible catalog", () => {
    const models = modelsFromOpenAIList({
      data: [
        { id: "gpt-5-mini", name: "GPT-5 mini" },
        { id: "text-embedding-3-large" },
        { id: "openai/gpt-4o" },
        { id: "whisper-1" },
        { id: "gpt-image-2" },
        { id: "mj_imagine" },
        { id: "seedance-2.0-fast" },
      ],
    });
    expect(models.map((model) => model.id)).toEqual([
      "gpt-5-mini",
      "text-embedding-3-large",
      "openai/gpt-4o",
      "whisper-1",
      "gpt-image-2",
      "mj_imagine",
      "seedance-2.0-fast",
    ]);
    expect(models[0]?.provider).toBe("openai");
  });

  it("copies a context window from the list payload", () => {
    const models = modelsFromOpenAIList({
      data: [{ id: "gpt-5-mini", context_length: 400000, max_tokens: 16384 }],
    });
    expect(models[0]).toMatchObject({
      id: "gpt-5-mini",
      contextLength: 400000,
      contextSource: "endpoint",
    });
  });
});

describe("modelsFromGoogleList", () => {
  it("strips models/ and keeps generateContent ids", () => {
    const models = modelsFromGoogleList({
      models: [
        {
          name: "models/gemini-3.5-flash",
          displayName: "Gemini 3.5 Flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    });
    expect(models).toEqual([
      expect.objectContaining({ id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "google" }),
    ]);
  });

  it("reads inputTokenLimit as the context window", () => {
    const models = modelsFromGoogleList({
      models: [
        {
          name: "models/gemini-3.5-flash",
          displayName: "Gemini 3.5 Flash",
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 1048576,
        },
      ],
    });
    expect(models[0]).toMatchObject({ contextLength: 1048576, contextSource: "endpoint" });
  });
});

describe("isChatModelId", () => {
  it("rejects audio and embedding ids", () => {
    expect(isChatModelId("gpt-5.6-terra")).toBe(true);
    expect(isChatModelId("doubao-seedance-2-0-260128")).toBe(false);
    expect(isChatModelId("gpt-image-2")).toBe(false);
    expect(isChatModelId("text-embedding-3-small")).toBe(false);
    expect(isChatModelId("doubao-seedream-4-0")).toBe(false);
  });
});

describe("guessDialect", () => {
  it("recognizes Anthropic keys and Volcengine hosts", () => {
    expect(guessDialectFromKey("sk-ant-test")).toBe("anthropic");
    expect(guessDialectFromUrl("https://ark.cn-beijing.volces.com")).toBe("volcengine");
    expect(guessDialectFromUrl("https://api.anthropic.com")).toBe("anthropic");
  });
});

describe("modelsFromAnthropicList", () => {
  it("reads display_name from the Models API", () => {
    const models = modelsFromAnthropicList({
      data: [{ id: "claude-sonnet-5", display_name: "Claude Sonnet 5", type: "model" }],
    });
    expect(models).toEqual([
      expect.objectContaining({ id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic" }),
    ]);
  });
});

describe("detectCompatibleApi", () => {
  it("falls through to Anthropic after an OpenAI-compatible probe fails", async () => {
    const detected = await detectCompatibleApi({
      apiKey: "generic-key",
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("anthropic.com")) {
          return new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5", display_name: "Claude Sonnet 5" }] }), {
            status: 200,
          });
        }
        return new Response("nope", { status: 401 });
      },
    });
    expect(detected.dialect).toBe("anthropic");
    expect(detected.models.map((model) => model.id)).toEqual(["claude-sonnet-5"]);
  });

  it("treats an Ark host as Volcengine even when the URL was pasted in the OpenAI field", async () => {
    const detected = await detectCompatibleApi({
      url: "https://ark.cn-beijing.volces.com",
      apiKey: "ark-test",
      fetch: async (input) => {
        const url = String(input);
        expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/models");
        return new Response(JSON.stringify({ data: [{ id: "doubao-seed-1-6-thinking" }] }), { status: 200 });
      },
    });
    expect(detected.dialect).toBe("volcengine");
    expect(detected.models.map((model) => model.id)).toEqual(["doubao-seed-1-6-thinking"]);
    expect(detected.models[0]?.provider).toBe("volcengine");
  });
});

describe("Toko Token default endpoint", () => {
  it("uses api.tokotokenai.com/v1 when no URL is saved", () => {
    expect(DEFAULT_OPENAI_BASE_URL).toBe("https://api.tokotokenai.com/v1");
    expect(resolvedOpenAIBaseUrl()).toBe("https://api.tokotokenai.com/v1");
    expect(resolvedOpenAIBaseUrl("https://api.tokotokenai.com")).toBe("https://api.tokotokenai.com/v1");
    expect(isDefaultOpenAIBaseUrl()).toBe(true);
    expect(isDefaultOpenAIBaseUrl("https://api.tokotokenai.com/v1")).toBe(true);
    expect(isOfficialOpenAIBaseUrl(DEFAULT_OPENAI_BASE_URL)).toBe(false);
    expect(isOfficialOpenAIBaseUrl("https://api.openai.com/v1")).toBe(true);
  });
});

describe("probeOpenAIModels", () => {
  it("defaults to Toko Token when no base URL is passed", async () => {
    const calls: string[] = [];
    await probeOpenAIModels({
      apiKey: "sk-test",
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ data: [{ id: "gpt-5.6-sol" }] }), { status: 200 });
      },
    });
    expect(calls[0]).toBe("https://api.tokotokenai.com/v1/models");
  });

  it("calls /models with a bearer token", async () => {
    const calls: string[] = [];
    const models = await probeOpenAIModels({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: "sk-test",
      fetch: async (input, init) => {
        calls.push(String(input));
        expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-test" });
        return new Response(JSON.stringify({ data: [{ id: "anthropic/claude-sonnet-4" }] }), { status: 200 });
      },
    });
    expect(calls[0]).toBe("https://openrouter.ai/api/v1/models");
    expect(models.map((model) => model.id)).toEqual(["anthropic/claude-sonnet-4"]);
  });
});

describe("probeGoogleModels", () => {
  it("sends the API key as x-goog-api-key header, NOT in the query string", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    await probeGoogleModels({
      apiKey: "AIzaTestKey",
      fetch: async (input, init) => {
        capturedUrl = String(input);
        capturedHeaders = (init as RequestInit).headers as Record<string, string>;
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      },
    });
    expect(capturedUrl).not.toContain("key=");
    expect(capturedUrl).not.toContain("AIzaTestKey");
    expect(capturedHeaders["x-goog-api-key"]).toBe("AIzaTestKey");
  });
});

describe("probe request hardening", () => {
  it("does not follow a redirect while carrying the provider key", async () => {
    const calls: string[] = [];
    await expect(
      probeOpenAIModels({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: "sk-test",
        fetch: async (input, init) => {
          calls.push(String(input));
          expect((init as RequestInit).redirect).toBe("manual");
          return new Response(null, { status: 302, headers: { location: "https://evil.example/models" } });
        },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(calls).toEqual(["https://openrouter.ai/api/v1/models"]);
  });

  it("keeps the query string out of the failure message", async () => {
    try {
      await probeOpenAIModels({
        baseURL: "https://api.example.com/v1?token=not-a-real-token",
        apiKey: "sk-test",
        fetch: async () => new Response("nope", { status: 401 }),
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      const message = (error as ApiError).message;
      expect(message).not.toContain("?");
      expect(message).not.toContain("not-a-real-token");
      expect(message).toContain("401");
    }
  });
});
