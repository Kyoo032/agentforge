import { describe, expect, it } from "vitest";
import {
  applyReasoningEffortToChatBody,
  applyReasoningToResponsesBody,
  closestReasoningEffort,
  coerceReasoningEffortForModel,
  isChatCompletionsUrl,
  isReasoningEffortExplicit,
  readOptionalReasoningEffort,
  readReasoningEffortChoice,
  REASONING_EFFORTS,
  REASONING_LADDER,
  resolveRequestReasoningEffort,
  THINKING_LABELS,
  toWireReasoningEffort,
  withoutReasoningEffort,
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

describe("applyReasoningToResponsesBody", () => {
  const sdkBody = { model: "gpt-6-luna", input: [{ role: "user" }], tools: [], stream: true, store: false };

  it("adds the block the SDK leaves out, right after input, with the summary the SDK writes for a level", () => {
    const next = applyReasoningToResponsesBody(sdkBody, "high") as Record<string, unknown>;
    expect(next.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(Object.keys(next)).toEqual(["model", "input", "reasoning", "tools", "stream", "store"]);
  });

  it("sends Off as effort none with no summary, the way the SDK writes it", () => {
    const next = applyReasoningToResponsesBody(sdkBody, "none") as Record<string, unknown>;
    expect(next.reasoning).toEqual({ effort: "none" });
  });

  it("puts the block last when the body has no input to sit after", () => {
    const next = applyReasoningToResponsesBody({ model: "m" }, "low") as Record<string, unknown>;
    expect(Object.keys(next)).toEqual(["model", "reasoning"]);
  });

  it("leaves a body that already carries a reasoning block alone: the SDK wrote it", () => {
    const written = { model: "gpt-5.6-luna", input: [], reasoning: { effort: "medium", summary: "auto" } };
    expect(applyReasoningToResponsesBody(written, "high")).toBe(written);
  });

  it("never mutates, and passes anything that is not an object body through", () => {
    const body = { model: "m", input: [] };
    applyReasoningToResponsesBody(body, "low");
    expect(body).toEqual({ model: "m", input: [] });
    expect(applyReasoningToResponsesBody("raw", "low")).toBe("raw");
    expect(applyReasoningToResponsesBody(null, "low")).toBeNull();
    const list: unknown[] = [];
    expect(applyReasoningToResponsesBody(list, "low")).toBe(list);
  });
});

describe("readReasoningEffortChoice", () => {
  it("says the effort was defaulted when the body names none", () => {
    expect(readReasoningEffortChoice({ content: "hi" })).toEqual({ effort: "medium", explicit: false });
    expect(readReasoningEffortChoice(null)).toEqual({ effort: "medium", explicit: false });
    expect(readReasoningEffortChoice([])).toEqual({ effort: "medium", explicit: false });
    expect(readReasoningEffortChoice({ thinking: true })).toEqual({ effort: "medium", explicit: false });
    expect(readReasoningEffortChoice({ reasoningEffort: null })).toEqual({ effort: "medium", explicit: false });
  });

  it("says the person chose it when the body carries a level, in any spelling", () => {
    expect(readReasoningEffortChoice({ reasoningEffort: "high" })).toEqual({ effort: "high", explicit: true });
    expect(readReasoningEffortChoice({ reasoningEffort: "medium" })).toEqual({ effort: "medium", explicit: true });
    expect(readReasoningEffortChoice({ reasoningEffort: "Deep" })).toEqual({ effort: "high", explicit: true });
    expect(readReasoningEffortChoice({ reasoningEffort: "ultra" })).toEqual({ effort: "ultra", explicit: true });
  });

  it("counts Off as a choice, whether it arrives as a level or as thinking false", () => {
    expect(readReasoningEffortChoice({ thinking: false })).toEqual({ effort: "none", explicit: true });
    expect(readReasoningEffortChoice({ reasoningEffort: "off" })).toEqual({ effort: "none", explicit: true });
    expect(readReasoningEffortChoice({ reasoningEffort: "max", thinking: false })).toEqual({
      effort: "none",
      explicit: true,
    });
  });

  it("rejects what readOptionalReasoningEffort rejects, and agrees with it on the level", () => {
    expect(() => readReasoningEffortChoice({ reasoningEffort: "ludicrous" })).toThrow(ApiError);
    expect(() => readReasoningEffortChoice({ reasoningEffort: 3 })).toThrow(ApiError);
    for (const body of [{}, { reasoningEffort: "xhigh" }, { thinking: false }, { reasoningEffort: "extra" }]) {
      expect(readReasoningEffortChoice(body).effort).toBe(readOptionalReasoningEffort(body));
    }
  });
});

describe("isReasoningEffortExplicit", () => {
  it("trusts the flag the host parsed", () => {
    expect(isReasoningEffortExplicit({ reasoningEffort: "medium", reasoningEffortExplicit: false })).toBe(false);
    expect(isReasoningEffortExplicit({ reasoningEffortExplicit: true })).toBe(true);
  });

  it("without a flag, a level or thinking false counts, and nothing at all does not", () => {
    expect(isReasoningEffortExplicit({})).toBe(false);
    expect(isReasoningEffortExplicit({ thinking: true })).toBe(false);
    expect(isReasoningEffortExplicit({ reasoningEffort: "low" })).toBe(true);
    expect(isReasoningEffortExplicit({ thinking: false })).toBe(true);
  });
});

describe("withoutReasoningEffort", () => {
  it("removes the field and keeps every other key and their order", () => {
    expect(withoutReasoningEffort({ model: "m", reasoning_effort: "high", stream: true })).toEqual({
      model: "m",
      stream: true,
    });
    expect(Object.keys(withoutReasoningEffort({ a: 1, reasoning_effort: "x", b: 2 }) as object)).toEqual(["a", "b"]);
  });

  it("returns the same body when there is nothing to remove, and never mutates", () => {
    const body = { model: "m" };
    expect(withoutReasoningEffort(body)).toBe(body);
    const withField = { model: "m", reasoning_effort: "low" };
    withoutReasoningEffort(withField);
    expect(withField).toEqual({ model: "m", reasoning_effort: "low" });
    expect(withoutReasoningEffort("raw")).toBe("raw");
    expect(withoutReasoningEffort(null)).toBeNull();
  });
});
