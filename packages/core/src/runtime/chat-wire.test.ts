import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MESSAGES_MAX_TOKENS,
  applyAnthropicMessagesBody,
  chatWireHeaders,
  isAnthropicMessagesUrl,
  isChatWire,
  isMissingWireEndpoint,
  readOptionalChatWire,
  resolveChatWire,
  shouldFallbackFromMessages,
  toAnthropicOutputEffort,
} from "./chat-wire";
import { shouldFallbackFromResponses } from "./api-mode";

describe("readOptionalChatWire", () => {
  it("defaults to auto when omitted", () => {
    expect(readOptionalChatWire({ content: "hi" })).toBe("auto");
    expect(readOptionalChatWire(null)).toBe("auto");
    expect(readOptionalChatWire({ wire: "" })).toBe("auto");
  });

  it("reads the four send-time wires", () => {
    expect(readOptionalChatWire({ wire: "auto" })).toBe("auto");
    expect(readOptionalChatWire({ wire: "chat_completions" })).toBe("chat_completions");
    expect(readOptionalChatWire({ wire: "responses" })).toBe("responses");
    expect(readOptionalChatWire({ wire: "anthropic_messages" })).toBe("anthropic_messages");
  });

  it("rejects unknown values", () => {
    expect(() => readOptionalChatWire({ wire: "grpc" })).toThrow(ApiError);
    expect(() => readOptionalChatWire({ wire: 3 })).toThrow(ApiError);
  });
});

describe("resolveChatWire", () => {
  it("keeps today's family pick on auto — Claude stays completions", () => {
    expect(resolveChatWire("auto", "claude-sonnet-5")).toBe("chat_completions");
    expect(resolveChatWire(undefined, "claude-sonnet-5")).toBe("chat_completions");
    expect(resolveChatWire("auto", "gpt-5.6-sol")).toBe("responses");
    expect(resolveChatWire("auto", "deepseek-v4-pro")).toBe("chat_completions");
  });

  it("does not lock a model to one POST path", () => {
    expect(resolveChatWire("anthropic_messages", "gpt-5.6-sol")).toBe("anthropic_messages");
    expect(resolveChatWire("chat_completions", "gpt-5.6-sol")).toBe("chat_completions");
    expect(resolveChatWire("responses", "claude-sonnet-5")).toBe("responses");
    expect(resolveChatWire("anthropic_messages", "claude-sonnet-5")).toBe("anthropic_messages");
  });
});

describe("chatWireHeaders", () => {
  it("uses Bearer on Completions and Responses", () => {
    expect(chatWireHeaders("chat_completions", "toko-key")).toEqual({
      Authorization: "Bearer toko-key",
    });
    expect(chatWireHeaders("responses", "toko-key")).toEqual({
      Authorization: "Bearer toko-key",
    });
    expect(chatWireHeaders("chat_completions", "toko-key")).not.toHaveProperty("x-api-key");
  });

  it("uses x-api-key + anthropic-version on Messages, never Bearer on the same request", () => {
    const headers = chatWireHeaders("anthropic_messages", "toko-key");
    expect(headers).toEqual({
      "x-api-key": "toko-key",
      "anthropic-version": ANTHROPIC_API_VERSION,
    });
    expect(headers).not.toHaveProperty("Authorization");
    expect(ANTHROPIC_API_VERSION).toBe("2023-06-01");
  });
});

describe("toAnthropicOutputEffort", () => {
  it("maps product ultra to max, not xhigh or ultra", () => {
    expect(toAnthropicOutputEffort("ultra")).toBe("max");
    expect(toAnthropicOutputEffort("high")).toBe("high");
    expect(toAnthropicOutputEffort("medium")).toBe("medium");
    expect(toAnthropicOutputEffort("low")).toBe("low");
    expect(toAnthropicOutputEffort("none")).toBeUndefined();
  });
});

describe("applyAnthropicMessagesBody", () => {
  it("sends thinking disabled on none — omitting thinking would turn adaptive on", () => {
    const body = applyAnthropicMessagesBody(
      {
        model: "claude-sonnet-5",
        messages: [],
        reasoning_effort: "none",
        store: false,
        provider: { zdr: true },
      },
      "none",
    );
    expect(body).toEqual({
      model: "claude-sonnet-5",
      messages: [],
      thinking: { type: "disabled" },
      max_tokens: ANTHROPIC_MESSAGES_MAX_TOKENS,
    });
    expect(JSON.stringify(body)).not.toContain("reasoning_effort");
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(JSON.stringify(body)).not.toContain('"store"');
    expect(JSON.stringify(body)).not.toContain("zdr");
  });

  it("sends adaptive thinking + output_config.effort max on ultra", () => {
    const body = applyAnthropicMessagesBody({ model: "claude-sonnet-5", messages: [] }, "ultra") as Record<
      string,
      unknown
    >;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "max" });
    expect(body.max_tokens).toBe(ANTHROPIC_MESSAGES_MAX_TOKENS);
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(JSON.stringify(body)).not.toContain('"enabled"');
    expect(JSON.stringify(body)).not.toContain('"ultra"');
    expect(JSON.stringify(body)).not.toContain("reasoning_effort");
    expect((body.output_config as { effort: string }).effort).not.toBe("adaptive");
  });

  it("maps mid-scale product effort onto output_config.effort", () => {
    const body = applyAnthropicMessagesBody({ model: "claude-sonnet-5" }, "medium") as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "medium" });
  });

  it("rewrites deprecated enabled + budget_tokens to adaptive", () => {
    const body = applyAnthropicMessagesBody(
      {
        model: "claude-sonnet-5",
        thinking: { type: "enabled", budget_tokens: 8000, budgetTokens: 8000 },
        max_tokens: 4096,
      },
      "high",
    ) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toEqual({ effort: "high" });
    expect(JSON.stringify(body)).not.toContain("budget_tokens");
    expect(JSON.stringify(body)).not.toContain("budgetTokens");
    expect(JSON.stringify(body)).not.toContain('"enabled"');
    expect(body.max_tokens).toBe(ANTHROPIC_MESSAGES_MAX_TOKENS);
  });
});

describe("isAnthropicMessagesUrl", () => {
  it("matches /v1/messages and not completions", () => {
    expect(isAnthropicMessagesUrl("https://api.tokotokenai.com/v1/messages")).toBe(true);
    expect(isAnthropicMessagesUrl("https://api.tokotokenai.com/v1/chat/completions")).toBe(false);
    expect(isAnthropicMessagesUrl("https://api.tokotokenai.com/v1/responses")).toBe(false);
  });
});

describe("404-only fallback", () => {
  it("treats 404 / unknown-url as a missing wire", () => {
    expect(isMissingWireEndpoint("404 Not Found")).toBe(true);
    expect(isMissingWireEndpoint("Unknown url")).toBe(true);
    expect(shouldFallbackFromMessages("404 Not Found (status_code=404)")).toBe(true);
  });

  it("does not treat a thinking 400 as try another wire", () => {
    const thinking400 =
      "thinking.type enabled with budget_tokens is not supported on claude-sonnet-5 (status_code=400)";
    expect(isMissingWireEndpoint(thinking400)).toBe(false);
    expect(shouldFallbackFromMessages(thinking400)).toBe(false);
    expect(shouldFallbackFromResponses(thinking400)).toBe(false);
    expect(isMissingWireEndpoint("Unauthorized (status_code=401)")).toBe(false);
  });
});

describe("isChatWire", () => {
  it("accepts the four wires only", () => {
    expect(isChatWire("auto")).toBe(true);
    expect(isChatWire("anthropic_messages")).toBe(true);
    expect(isChatWire("grpc")).toBe(false);
  });
});
