import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import {
  applyReasoningEffortToChatBody,
  coerceReasoningEffortForModel,
  isChatCompletionsUrl,
  readOptionalReasoningEffort,
  resolveRequestReasoningEffort,
  THINKING_LABELS,
  toWireReasoningEffort,
} from "./reasoning-effort";

describe("readOptionalReasoningEffort", () => {
  it("defaults to medium when omitted", () => {
    expect(readOptionalReasoningEffort({ content: "hi" })).toBe("medium");
    expect(readOptionalReasoningEffort(null)).toBe("medium");
  });

  it("maps Chat Thinking labels onto the backend scale", () => {
    expect(THINKING_LABELS).toEqual({
      none: "Off",
      low: "Light",
      medium: "Normal",
      high: "Deep",
      ultra: "Max",
    });
  });

  it("reads the none-to-ultra scale", () => {
    expect(readOptionalReasoningEffort({ reasoningEffort: "none" })).toBe("none");
    expect(readOptionalReasoningEffort({ reasoningEffort: "low" })).toBe("low");
    expect(readOptionalReasoningEffort({ reasoningEffort: "ultra" })).toBe("ultra");
  });

  it("maps aliases onto the product scale", () => {
    expect(readOptionalReasoningEffort({ reasoningEffort: "max" })).toBe("ultra");
    expect(readOptionalReasoningEffort({ reasoningEffort: "xhigh" })).toBe("ultra");
    expect(readOptionalReasoningEffort({ reasoningEffort: "light" })).toBe("low");
    expect(readOptionalReasoningEffort({ reasoningEffort: "normal" })).toBe("medium");
    expect(readOptionalReasoningEffort({ reasoningEffort: "deep" })).toBe("high");
    expect(readOptionalReasoningEffort({ reasoningEffort: "off" })).toBe("none");
  });

  it("treats thinking false as none when effort is omitted", () => {
    expect(readOptionalReasoningEffort({ thinking: false })).toBe("none");
  });

  it("rejects unknown values", () => {
    expect(() => readOptionalReasoningEffort({ reasoningEffort: "ludicrous" })).toThrow(ApiError);
  });
});

describe("resolveRequestReasoningEffort", () => {
  it("is none when thinking is off", () => {
    expect(resolveRequestReasoningEffort({ thinking: false, reasoningEffort: "high" })).toBe("none");
  });

  it("keeps ultra when thinking is on", () => {
    expect(resolveRequestReasoningEffort({ thinking: true, reasoningEffort: "ultra" })).toBe("ultra");
    expect(resolveRequestReasoningEffort({})).toBe("medium");
  });
});

describe("coerceReasoningEffortForModel", () => {
  it("lifts none to low on GPT-5.6 Luna", () => {
    expect(coerceReasoningEffortForModel("gpt-5.6-luna", "none")).toBe("low");
    expect(coerceReasoningEffortForModel("openai/gpt-5.6-luna", "none")).toBe("low");
  });

  it("keeps none on ordinary chat models", () => {
    expect(coerceReasoningEffortForModel("deepseek-v4-flash", "none")).toBe("none");
  });

  it("keeps an explicit low", () => {
    expect(coerceReasoningEffortForModel("gpt-5.6-luna", "low")).toBe("low");
  });
});

describe("toWireReasoningEffort", () => {
  it("sends ultra to the gateway and xhigh to official OpenAI", () => {
    expect(toWireReasoningEffort("ultra")).toBe("ultra");
    expect(toWireReasoningEffort("ultra", { officialOpenAI: true })).toBe("xhigh");
    expect(toWireReasoningEffort("high")).toBe("high");
  });
});

describe("applyReasoningEffortToChatBody", () => {
  it("sets reasoning_effort on a chat body", () => {
    expect(applyReasoningEffortToChatBody({ model: "claude-opus-5" }, "ultra")).toEqual({
      model: "claude-opus-5",
      reasoning_effort: "ultra",
    });
  });

  it("detects chat completions URLs", () => {
    expect(isChatCompletionsUrl("https://api.tokotokenai.com/v1/chat/completions")).toBe(true);
    expect(isChatCompletionsUrl("https://api.tokotokenai.com/v1/responses")).toBe(false);
  });
});
