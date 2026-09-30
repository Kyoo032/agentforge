import { afterEach, describe, expect, it } from "vitest";
import {
  LEARNED_EFFORT_LIMIT_CAP,
  LEARNED_EFFORT_LIMIT_TTL_MS,
  capEffortAtCeiling,
  classifyEffortRejection,
  learnedEffortLimit,
  limitFromHeal,
  rememberEffortLimit,
  resetLearnedEffortLimits,
  saferEffortAction,
} from "./effort-selfheal";

function body(message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error: { message, type: "invalid_request_error", ...extra } });
}

afterEach(() => {
  resetLearnedEffortLimits();
});

describe("classifyEffortRejection", () => {
  it("reads a rejected value: the parameter is fine, the level is not", () => {
    const samples = [
      body("Unsupported value: 'reasoning.effort' does not support 'xhigh' with this model. Supported values are: 'low', 'medium', and 'high'.", {
        param: "reasoning.effort",
        code: "unsupported_value",
      }),
      body("Invalid value: 'ultra'. Supported values are: 'none', 'low', 'medium', 'high', 'xhigh', 'max'.", {
        param: "reasoning_effort",
      }),
      body("output_config.effort: Input should be 'low', 'medium', 'high' or 'max'"),
      body("reasoning_effort must be one of low, medium, high"),
      // Google's answer to Off on a model that cannot be turned off.
      JSON.stringify({
        error: { code: 400, message: "Budget 0 is invalid. This model only works in thinking mode.", status: "INVALID_ARGUMENT" },
      }),
    ];
    for (const text of samples) {
      expect(classifyEffortRejection({ status: 400, body: text }), text).toEqual({ kind: "value" });
    }
  });

  it("reads a rejected parameter: the model does not take it at all", () => {
    const samples = [
      body("Unsupported parameter: 'reasoning_effort' is not supported with this model.", {
        param: "reasoning_effort",
        code: "unsupported_parameter",
      }),
      body("Unrecognized request argument supplied: reasoning_effort"),
      body("Unknown parameter: 'reasoning.effort'."),
      body("Extra inputs are not permitted: thinking"),
      body("This model does not support thinking."),
      body("Unable to submit request because thinking_budget is not supported by this model."),
      body("reasoning_effort is not supported for this model"),
    ];
    for (const text of samples) {
      expect(classifyEffortRejection({ status: 400, body: text }), text).toEqual({ kind: "parameter" });
    }
  });

  it("takes a 422, and a 400 the gateway reports inside its own body", () => {
    expect(classifyEffortRejection({ status: 422, body: body("Invalid value: 'max' for reasoning_effort") })).toEqual({
      kind: "value",
    });
    expect(
      classifyEffortRejection({
        status: 502,
        body: JSON.stringify({ error: { message: "Unsupported value: 'max' for reasoning_effort", status_code: 400 } }),
      }),
    ).toEqual({ kind: "value" });
  });

  it("does not touch any other 400: context length, a bad key, an unknown model, a bad body", () => {
    const others = [
      body("This model's maximum context length is 128000 tokens. However, your messages resulted in 200000 tokens (including reasoning effort).", {
        code: "context_length_exceeded",
      }),
      body("Invalid API key provided.", { code: "invalid_api_key" }),
      body("The model `gpt-9` does not exist or you do not have access to it.", { code: "model_not_found" }),
      body("messages: roles must alternate between user and assistant"),
      body("Invalid schema for function 'datetime': 'required' is required to be supplied."),
      body("max_tokens: 20000 > 16384, which is the maximum allowed"),
      "not even json",
      "",
    ];
    for (const text of others) {
      expect(classifyEffortRejection({ status: 400, body: text }), text).toBeNull();
    }
  });

  it("does not take a 400 that only mentions thinking, because every 400 is filed under invalid_request_error", () => {
    // Real refusals from other rules, all of which name the word and none of which refuse the parameter.
    const others = [
      body("The reasoning_content in the thinking mode must be passed back to the API."),
      body("thinking is enabled but reasoning_content is missing in assistant tool call message at index 2"),
      body("messages.1.content.0.thinking.signature: Field required"),
      body("temperature may only be set to 1 when thinking is enabled"),
    ];
    for (const text of others) {
      expect(classifyEffortRejection({ status: 400, body: text }), text).toBeNull();
    }
  });

  it("leaves a tools-on-Completions refusal to the wire rules, whose fix is not a lower level", () => {
    expect(
      classifyEffortRejection({
        status: 400,
        body: body(
          "Function tools with reasoning_effort are not supported for gpt-5.6-sol in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
        ),
      }),
    ).toBeNull();
  });

  it("does not take a refused parameter for a missing model just because it says 'does not exist'", () => {
    expect(
      classifyEffortRejection({ status: 400, body: body("The parameter reasoning_effort does not exist for this endpoint. Unknown parameter.") }),
    ).toEqual({ kind: "parameter" });
  });

  it("never reads a failure that is not a request rejection", () => {
    const text = body("Unsupported value: 'xhigh' for reasoning_effort");
    for (const status of [401, 403, 404, 429, 500, 503]) {
      expect(classifyEffortRejection({ status, body: text }), String(status)).toBeNull();
    }
  });
});

describe("saferEffortAction", () => {
  it("steps a rejected level down one within the allowed list", () => {
    const allowed = ["none", "low", "medium", "high", "xhigh", "max"] as const;
    expect(saferEffortAction("max", allowed, { kind: "value" })).toEqual({ action: "step_down", level: "xhigh" });
    expect(saferEffortAction("xhigh", allowed, { kind: "value" })).toEqual({ action: "step_down", level: "high" });
    expect(saferEffortAction("low", allowed, { kind: "value" })).toEqual({ action: "step_down", level: "none" });
  });

  it("steps within a list with gaps, not down the whole ladder", () => {
    expect(saferEffortAction("high", ["low", "high"], { kind: "value" })).toEqual({ action: "step_down", level: "low" });
    expect(saferEffortAction("ultra", ["low", "medium", "high"], { kind: "value" })).toEqual({
      action: "step_down",
      level: "high",
    });
  });

  it("drops the parameter when the level was already the lowest allowed", () => {
    expect(saferEffortAction("low", ["low", "medium", "high"], { kind: "value" })).toEqual({ action: "drop" });
    expect(saferEffortAction("none", ["none", "low", "medium"], { kind: "value" })).toEqual({ action: "drop" });
  });

  it("drops the parameter at once when the model does not take it at all", () => {
    expect(saferEffortAction("xhigh", ["none", "low", "medium", "high", "xhigh"], { kind: "parameter" })).toEqual({
      action: "drop",
    });
  });

  it("has nothing to heal when no effort was sent", () => {
    expect(saferEffortAction(undefined, ["low", "medium", "high"], { kind: "value" })).toBeNull();
    expect(saferEffortAction(undefined, ["low", "medium", "high"], { kind: "parameter" })).toBeNull();
  });
});

describe("limitFromHeal: what a retry that answered teaches", () => {
  it("a refused level from Deep up teaches a ceiling: a gateway that refuses Extra refuses Max and Ultra too", () => {
    expect(limitFromHeal("ultra", "max", { kind: "value" })).toEqual({ kind: "ceiling", level: "max" });
    expect(limitFromHeal("xhigh", "high", { kind: "value" })).toEqual({ kind: "ceiling", level: "high" });
  });

  it("a refused level at or below Deep teaches only that level: Off refused says nothing about Deep", () => {
    expect(limitFromHeal("none", undefined, { kind: "value" })).toEqual({ kind: "replace", from: "none", to: undefined });
    expect(limitFromHeal("low", "none", { kind: "value" })).toEqual({ kind: "replace", from: "low", to: "none" });
    expect(limitFromHeal("high", "medium", { kind: "value" })).toEqual({ kind: "replace", from: "high", to: "medium" });
  });

  it("a refused parameter teaches that the model takes none", () => {
    expect(limitFromHeal("high", undefined, { kind: "parameter" })).toEqual({ kind: "drop" });
    expect(limitFromHeal("none", undefined, { kind: "parameter" })).toEqual({ kind: "drop" });
  });

  it("a ceiling needs a level to hold at: a top level refused with nothing under it is only that level", () => {
    expect(limitFromHeal("max", undefined, { kind: "value" })).toEqual({ kind: "replace", from: "max", to: undefined });
  });
});

describe("learned limits", () => {
  it("remembers a limit per bare model id, whatever the vendor prefix or case", () => {
    expect(learnedEffortLimit("deepseek-v4-flash")).toBeUndefined();
    rememberEffortLimit("deepseek-v4-flash", { kind: "ceiling", level: "high" });
    expect(learnedEffortLimit("deepseek-v4-flash")).toEqual({ drop: false, ceiling: "high", replace: {} });
    expect(learnedEffortLimit("DeepSeek/DeepSeek-V4-Flash")).toEqual({ drop: false, ceiling: "high", replace: {} });
    expect(learnedEffortLimit("deepseek-v4-pro")).toBeUndefined();
  });

  it("keeps the stricter ceiling, adds level swaps side by side, and lets a drop stand over both", () => {
    rememberEffortLimit("m", { kind: "ceiling", level: "high" });
    rememberEffortLimit("m", { kind: "ceiling", level: "medium" });
    rememberEffortLimit("m", { kind: "ceiling", level: "xhigh" });
    expect(learnedEffortLimit("m")?.ceiling).toBe("medium");
    rememberEffortLimit("m", { kind: "replace", from: "none", to: undefined });
    rememberEffortLimit("m", { kind: "replace", from: "low", to: "none" });
    expect(learnedEffortLimit("m")).toEqual({ drop: false, ceiling: "medium", replace: { none: "omit", low: "none" } });
    rememberEffortLimit("m", { kind: "drop" });
    expect(learnedEffortLimit("m")?.drop).toBe(true);
    rememberEffortLimit("m", { kind: "ceiling", level: "low" });
    expect(learnedEffortLimit("m")?.drop).toBe(true);
  });

  it("is kept apart per scope: what one tenant's key refused says nothing about another's", () => {
    rememberEffortLimit("m", { kind: "drop" }, "tenant-a");
    expect(learnedEffortLimit("m", "tenant-a")?.drop).toBe(true);
    expect(learnedEffortLimit("m", "tenant-b")).toBeUndefined();
    expect(learnedEffortLimit("m")).toBeUndefined();
  });

  it("expires: nothing learned from one refusal is permanent", () => {
    const start = 1_800_000_000_000;
    rememberEffortLimit("m", { kind: "ceiling", level: "high" }, "", start);
    expect(learnedEffortLimit("m", "", start + LEARNED_EFFORT_LIMIT_TTL_MS - 1)?.ceiling).toBe("high");
    expect(learnedEffortLimit("m", "", start + LEARNED_EFFORT_LIMIT_TTL_MS)).toBeUndefined();
    // Gone for good, not just hidden.
    expect(learnedEffortLimit("m", "", start)).toBeUndefined();
  });

  it("restarts the clock on every lesson", () => {
    const start = 1_800_000_000_000;
    rememberEffortLimit("m", { kind: "ceiling", level: "high" }, "", start);
    rememberEffortLimit("m", { kind: "ceiling", level: "medium" }, "", start + LEARNED_EFFORT_LIMIT_TTL_MS - 1);
    expect(learnedEffortLimit("m", "", start + LEARNED_EFFORT_LIMIT_TTL_MS + 1000)?.ceiling).toBe("medium");
  });

  it("is cleared by a reset", () => {
    rememberEffortLimit("a", { kind: "drop" });
    rememberEffortLimit("b", { kind: "ceiling", level: "low" }, "tenant-a");
    resetLearnedEffortLimits();
    expect(learnedEffortLimit("a")).toBeUndefined();
    expect(learnedEffortLimit("b", "tenant-a")).toBeUndefined();
  });

  it("stays bounded: the oldest model is forgotten first", () => {
    for (let index = 0; index < LEARNED_EFFORT_LIMIT_CAP + 5; index += 1) {
      rememberEffortLimit(`model-${index}`, { kind: "drop" });
    }
    expect(learnedEffortLimit("model-0")).toBeUndefined();
    expect(learnedEffortLimit(`model-${LEARNED_EFFORT_LIMIT_CAP + 4}`)?.drop).toBe(true);
  });

  it("ignores a blank id", () => {
    rememberEffortLimit("  ", { kind: "drop" });
    expect(learnedEffortLimit("  ")).toBeUndefined();
  });
});

describe("capEffortAtCeiling", () => {
  const allowed = ["none", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

  it("leaves a level at or below the ceiling alone", () => {
    expect(capEffortAtCeiling("medium", "high", allowed)).toBe("medium");
    expect(capEffortAtCeiling("high", "high", allowed)).toBe("high");
    expect(capEffortAtCeiling("none", "high", allowed)).toBe("none");
  });

  it("snaps a level above the ceiling to the ceiling, or the nearest allowed level under it", () => {
    expect(capEffortAtCeiling("ultra", "high", allowed)).toBe("high");
    expect(capEffortAtCeiling("max", "high", ["low", "medium", "xhigh", "max"])).toBe("medium");
  });

  it("keeps the level when nothing allowed sits under the ceiling", () => {
    expect(capEffortAtCeiling("max", "low", ["high", "max"])).toBe("max");
  });
});
