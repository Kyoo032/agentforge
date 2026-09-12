import { describe, expect, it } from "vitest";
import {
  applyReasoningEffortToChatBody,
  closestReasoningEffort,
  coerceReasoningEffortForModel,
  isChatCompletionsUrl,
  readOptionalReasoningEffort,
  REASONING_EFFORTS,
  REASONING_LADDER,
  resolveRequestReasoningEffort,
  THINKING_LABELS,
  toWireReasoningEffort,
} from "./reasoning-effort";
import { ApiError } from "../errors";

describe("readOptionalReasoningEffort", () => {
  it("defaults to medium when omitted", () => {
    expect(readOptionalReasoningEffort({ content: "hi" })).toBe("medium");
    expect(readOptionalReasoningEffort(null)).toBe("medium");
  });

  it("maps Chat Thinking labels onto the kernel scale", () => {
    expect(REASONING_LADDER).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(REASONING_EFFORTS).toEqual(["none", "low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(THINKING_LABELS).toEqual({
      none: "Off",
      low: "Light",
      medium: "Normal",
      high: "Deep",
      xhigh: "Extra",
      max: "Max",
      ultra: "Ultra",
    });
  });

  it("reads every kernel string as itself, including minimal", () => {
    expect(readOptionalReasoningEffort({ reasoningEffort: "none" })).toBe("none");
    expect(readOptionalReasoningEffort({ reasoningEffort: "minimal" })).toBe("minimal");
    expect(readOptionalReasoningEffort({ reasoningEffort: "xhigh" })).toBe("xhigh");
    expect(readOptionalReasoningEffort({ reasoningEffort: "max" })).toBe("max");
    expect(readOptionalReasoningEffort({ reasoningEffort: "ultra" })).toBe("ultra");
  });

  it("maps UI-word aliases, not max, xhigh, or minimal", () => {
    expect(readOptionalReasoningEffort({ reasoningEffort: "light" })).toBe("low");
    expect(readOptionalReasoningEffort({ reasoningEffort: "normal" })).toBe("medium");
    expect(readOptionalReasoningEffort({ reasoningEffort: "deep" })).toBe("high");
    expect(readOptionalReasoningEffort({ reasoningEffort: "extra" })).toBe("xhigh");
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

  it("keeps max and ultra when thinking is on", () => {
    expect(resolveRequestReasoningEffort({ thinking: true, reasoningEffort: "ultra" })).toBe("ultra");
    expect(resolveRequestReasoningEffort({ thinking: true, reasoningEffort: "max" })).toBe("max");
    expect(resolveRequestReasoningEffort({})).toBe("medium");
  });
});

describe("closestReasoningEffort", () => {
  it("returns an allowed value unchanged", () => {
    expect(closestReasoningEffort("max", ["none", "low", "max"])).toBe("max");
  });

  it("picks the nearest ladder neighbor; tie goes lower (cheaper)", () => {
    expect(closestReasoningEffort("xhigh", ["high", "ultra"])).toBe("high");
    expect(closestReasoningEffort("medium", ["low", "high"])).toBe("low");
  });

  it("does not alias max or xhigh to ultra when those are allowed", () => {
    expect(closestReasoningEffort("max", ["none", "low", "medium", "high", "xhigh", "max", "ultra"])).toBe("max");
    expect(closestReasoningEffort("xhigh", ["none", "low", "medium", "high", "xhigh", "max", "ultra"])).toBe("xhigh");
  });

  it("never upgrades Off when none is allowed", () => {
    expect(closestReasoningEffort("none", ["none", "low", "medium"])).toBe("none");
  });

  it("lifts Off to the cheapest thinking-on level when none is forbidden", () => {
    expect(closestReasoningEffort("none", ["low", "medium", "high", "xhigh", "max"])).toBe("low");
  });
});

describe("coerceReasoningEffortForModel", () => {
  it("lifts none to low on GPT-6", () => {
    expect(coerceReasoningEffortForModel("gpt-6-astra", "none")).toBe("low");
    expect(coerceReasoningEffortForModel("openai/gpt-6", "none")).toBe("low");
  });

  it("keeps none on GPT-5.6 Luna and ordinary chat models", () => {
    expect(coerceReasoningEffortForModel("gpt-5.6-luna", "none")).toBe("none");
    expect(coerceReasoningEffortForModel("deepseek-v4-flash", "none")).toBe("none");
  });
});

describe("toWireReasoningEffort", () => {
  it("sends Completions the kernel string, including xhigh, max, and ultra", () => {
    expect(toWireReasoningEffort("ultra")).toBe("ultra");
    expect(toWireReasoningEffort("max")).toBe("max");
    expect(toWireReasoningEffort("xhigh")).toBe("xhigh");
  });

  it("maps ultra to max on official OpenAI, never xhigh, and never remaps max", () => {
    expect(toWireReasoningEffort("ultra", { officialOpenAI: true })).toBe("max");
    expect(toWireReasoningEffort("ultra", { officialOpenAI: true, responses: true })).toBe("max");
    expect(toWireReasoningEffort("max", { officialOpenAI: true, responses: true })).toBe("max");
  });
});

describe("applyReasoningEffortToChatBody", () => {
  it("sets reasoning_effort on a chat body", () => {
    expect(applyReasoningEffortToChatBody({ model: "kimi-k2.5" }, "ultra")).toEqual({
      model: "kimi-k2.5",
      reasoning_effort: "ultra",
    });
    expect(applyReasoningEffortToChatBody({ model: "kimi-k2.5" }, "max")).toEqual({
      model: "kimi-k2.5",
      reasoning_effort: "max",
    });
  });

  it("detects chat completions URLs", () => {
    expect(isChatCompletionsUrl("https://api.tokotokenai.com/v1/chat/completions")).toBe(true);
    expect(isChatCompletionsUrl("https://api.tokotokenai.com/v1/responses")).toBe(false);
  });
});
