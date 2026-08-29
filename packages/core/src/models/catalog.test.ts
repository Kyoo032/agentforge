import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { DEFAULT_CHAT_MODEL } from "../agents/default-chat";
import {
  getChatModel,
  intersectModalities,
  isGoogleChatModel,
  listChatModels,
  mergeChatCatalog,
  readOptionalModel,
  resolveChatModel,
  resolveModelProvider,
} from "./catalog";

describe("listChatModels", () => {
  it("exposes current OpenAI and Gemini chat models with modality flags", () => {
    const models = listChatModels();
    const ids = models.map((model) => model.id);
    expect(ids).toContain(DEFAULT_CHAT_MODEL);
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("glm-5.3");
    expect(ids).toContain("gpt-5.6-sol");
    expect(ids).toContain("gpt-5.6-terra");
    expect(ids).toContain("gpt-5.6-luna");
    expect(ids).toContain("gpt-5-mini");
    expect(ids).toContain("gpt-4o-mini");
    expect(ids).toContain("gemini-3.6-flash");
    expect(ids).toContain("gemini-3.5-flash");
    expect(ids).toContain("gemini-2.0-flash");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("claude-sonnet-5");
    expect(ids.indexOf("deepseek-v4-pro")).toBeLessThan(ids.indexOf("gpt-5-mini"));
    expect(ids.indexOf("gpt-5.6-sol")).toBeLessThan(ids.indexOf("gpt-4o-mini"));
    expect(ids).toContain("doubao-seedance-2-0-260128");
    expect(getChatModel("claude-sonnet-5")?.provider).toBe("anthropic");
    expect(getChatModel("doubao-seedance-2-0-260128")?.provider).toBe("volcengine");
    expect(getChatModel("gemini-3.6-flash")?.inputModalities).toEqual(["text", "image", "video"]);
    expect(getChatModel("gpt-5.6-sol")?.inputModalities).toEqual(["text", "image"]);
  });
});

describe("mergeChatCatalog", () => {
  it("replaces a provider when the endpoint returned models", () => {
    const merged = mergeChatCatalog({
      openai: [{ id: "openai/gpt-4o", label: "GPT-4o", provider: "openai", inputModalities: ["text", "image"] }],
    });
    expect(merged.filter((model) => model.provider === "openai").map((model) => model.id)).toEqual(["openai/gpt-4o"]);
    expect(merged.some((model) => model.id === "gemini-3.5-flash")).toBe(true);
  });

  it("drops duplicate ids when a gateway already listed them", () => {
    const merged = mergeChatCatalog({
      openai: [
        { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "openai", inputModalities: ["text", "image"] },
      ],
    });
    expect(merged.filter((model) => model.id === "claude-sonnet-5")).toHaveLength(1);
  });
});

describe("isGoogleChatModel", () => {
  it("routes Gemini and Gemma ids to Google", () => {
    expect(isGoogleChatModel("gemini-3.5-flash")).toBe(true);
    expect(isGoogleChatModel("gemma-4-31b-it")).toBe(true);
    expect(isGoogleChatModel("gpt-5-mini")).toBe(false);
  });
});

describe("resolveModelProvider", () => {
  it("maps Claude, Doubao, and Seedance ids", () => {
    expect(resolveModelProvider("claude-sonnet-5")).toBe("anthropic");
    expect(resolveModelProvider("doubao-seed-1-6-thinking")).toBe("volcengine");
    expect(resolveModelProvider("doubao-seedance-2-0-260128")).toBe("volcengine");
  });

  it("keeps OpenRouter-style Anthropic ids on the OpenAI-compatible client", () => {
    expect(resolveModelProvider("anthropic/claude-sonnet-4")).toBe("openai");
  });
});

describe("resolveChatModel", () => {
  it("keeps the agent default when the client omits a model", () => {
    expect(resolveChatModel(undefined, "gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("accepts a catalog model override", () => {
    expect(resolveChatModel("gemini-3.6-flash", "gpt-5-mini")).toBe("gemini-3.6-flash");
  });

  it("accepts a probed model that is not in the static catalog", () => {
    expect(
      resolveChatModel("openrouter/custom", "gpt-5-mini", [
        {
          id: "openrouter/custom",
          label: "Custom",
          provider: "openai",
          inputModalities: ["text"],
        },
      ]),
    ).toBe("openrouter/custom");
  });

  it("rejects unknown overrides", () => {
    try {
      resolveChatModel("not-a-model", "gpt-5-mini");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("unknown_model");
    }
  });
});

describe("readOptionalModel", () => {
  it("reads model from a run body", () => {
    expect(readOptionalModel({ content: "hi", model: "gpt-5.6-terra" })).toBe("gpt-5.6-terra");
    expect(readOptionalModel({ content: "hi" })).toBeUndefined();
    expect(readOptionalModel({ content: "hi", model: "" })).toBeUndefined();
  });
});

describe("intersectModalities", () => {
  it("keeps only modalities both the agent and model allow", () => {
    expect(intersectModalities(["text", "image", "video"], ["text", "image"])).toEqual(["text", "image"]);
  });
});
