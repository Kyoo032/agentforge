import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEffortState, planEffort } from "./effort-plan";
import { learnedEffortLimit, rememberEffortLimit, resetLearnedEffortLimits } from "./effort-selfheal";

const COMPLETIONS = { wire: "chat_completions", officialOpenAI: false } as const;

function rejected(message: string, status = 400): { status: number; body: string } {
  return { status, body: JSON.stringify({ error: { message, type: "invalid_request_error" } }) };
}

afterEach(() => {
  resetLearnedEffortLimits();
  vi.restoreAllMocks();
});

describe("planEffort", () => {
  it("snaps a known model exactly as the allowlist always did, chosen or not", () => {
    for (const explicit of [true, false]) {
      expect(planEffort("deepseek-v4-flash", { requested: "medium", explicit }, COMPLETIONS).level).toBe("medium");
      expect(planEffort("deepseek-v4-flash", { requested: "ultra", explicit }, COMPLETIONS).level).toBe("ultra");
      expect(planEffort("gpt-6-astra", { requested: "none", explicit }, { wire: "responses" }).level).toBe("low");
      expect(planEffort("gpt-5.6-luna", { requested: "none", explicit }, { wire: "responses" }).level).toBe("none");
      expect(planEffort("claude-sonnet-5", { requested: "ultra", explicit }, { wire: "anthropic_messages" }).level).toBe(
        "max",
      );
      expect(planEffort("gemini-3.5-flash", { requested: "max", explicit }, { wire: "google_generate_content" }).level).toBe(
        "high",
      );
    }
  });

  it("sends an unrecognised model no effort at all unless the person chose one", () => {
    const plan = planEffort("some-new-lab-model", { requested: "medium", explicit: false }, COMPLETIONS);
    expect(plan.level).toBeUndefined();
    expect(plan.requested).toBe("medium");
    expect(planEffort("some-new-lab-model", { requested: "high", explicit: false }, { wire: "responses" }).level).toBeUndefined();
  });

  it("gives an unrecognised model the chosen level, capped at high", () => {
    const of = (requested: "low" | "medium" | "high" | "xhigh" | "max" | "ultra") =>
      planEffort("some-new-lab-model", { requested, explicit: true }, COMPLETIONS).level;
    expect(of("low")).toBe("low");
    expect(of("medium")).toBe("medium");
    expect(of("high")).toBe("high");
    expect(of("xhigh")).toBe("high");
    expect(of("max")).toBe("high");
    expect(of("ultra")).toBe("high");
  });

  it("omits the parameter for Off on an unrecognised model, and never sends none", () => {
    expect(planEffort("some-new-lab-model", { requested: "none", explicit: true }, COMPLETIONS).level).toBeUndefined();
    expect(planEffort("some-new-lab-model", { requested: "none", explicit: true }, { wire: "responses" }).level).toBeUndefined();
  });

  it("holds a known model at a learned ceiling and leaves lower levels alone", () => {
    rememberEffortLimit("deepseek-v4-flash", { kind: "ceiling", level: "high" });
    expect(planEffort("deepseek-v4-flash", { requested: "ultra", explicit: true }, COMPLETIONS).level).toBe("high");
    expect(planEffort("deepseek-v4-flash", { requested: "xhigh", explicit: false }, COMPLETIONS).level).toBe("high");
    expect(planEffort("deepseek-v4-flash", { requested: "medium", explicit: true }, COMPLETIONS).level).toBe("medium");
    expect(planEffort("deepseek-v4-flash", { requested: "none", explicit: true }, COMPLETIONS).level).toBe("none");
    expect(planEffort("deepseek-v4-pro", { requested: "ultra", explicit: true }, COMPLETIONS).level).toBe("ultra");
  });

  it("swaps only the level that was refused, and leaves every other level alone", () => {
    rememberEffortLimit("gemini-3.5-flash", { kind: "replace", from: "none", to: undefined });
    const gemini = { wire: "google_generate_content" } as const;
    expect(planEffort("gemini-3.5-flash", { requested: "none", explicit: true }, gemini).level).toBeUndefined();
    expect(planEffort("gemini-3.5-flash", { requested: "high", explicit: true }, gemini).level).toBe("high");
    expect(planEffort("gemini-3.5-flash", { requested: "low", explicit: true }, gemini).level).toBe("low");
    rememberEffortLimit("deepseek-v4-flash", { kind: "replace", from: "low", to: "none" });
    expect(planEffort("deepseek-v4-flash", { requested: "low", explicit: true }, COMPLETIONS).level).toBe("none");
    expect(planEffort("deepseek-v4-flash", { requested: "medium", explicit: true }, COMPLETIONS).level).toBe("medium");
  });

  it("keeps what one tenant learned to that tenant", () => {
    rememberEffortLimit("deepseek-v4-flash", { kind: "ceiling", level: "high" }, "tenant-a");
    const level = (scope?: string) =>
      planEffort("deepseek-v4-flash", { requested: "ultra", explicit: true }, { ...COMPLETIONS, ...(scope ? { scope } : {}) }).level;
    expect(level("tenant-a")).toBe("high");
    expect(level("tenant-b")).toBe("ultra");
    expect(level()).toBe("ultra");
  });

  it("drops the parameter for a model that was learned not to take it", () => {
    rememberEffortLimit("deepseek-v4-flash", { kind: "drop" });
    expect(planEffort("deepseek-v4-flash", { requested: "high", explicit: true }, COMPLETIONS).level).toBeUndefined();
    expect(planEffort("deepseek-v4-flash", { requested: "none", explicit: true }, COMPLETIONS).level).toBeUndefined();
  });
});

describe("createEffortState", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  function state(modelId = "deepseek-v4-flash", requested: "medium" | "high" | "ultra" | "low" = "ultra") {
    return createEffortState({
      modelId,
      requested,
      explicit: true,
      wire: "chat_completions",
      officialOpenAI: false,
    });
  }

  it("starts from the plan", () => {
    expect(state().level()).toBe("ultra");
    expect(state("some-new-lab-model", "high").level()).toBe("high");
  });

  it("steps the level down one on a value rejection, and remembers it once the retry answers", () => {
    const effort = state();
    expect(effort.heal(rejected("Unsupported value: 'ultra' for reasoning_effort. Supported values are: 'low', 'high', 'max'."), "chat_completions")).toBe(true);
    expect(effort.level()).toBe("max");
    expect(learnedEffortLimit("deepseek-v4-flash")).toBeUndefined();
    effort.settle(true);
    expect(learnedEffortLimit("deepseek-v4-flash")).toEqual({ drop: false, ceiling: "max", replace: {} });
  });

  it("drops the parameter when the model takes no such parameter", () => {
    const effort = state();
    expect(effort.heal(rejected("Unsupported parameter: 'reasoning_effort' is not supported with this model."), "chat_completions")).toBe(true);
    expect(effort.level()).toBeUndefined();
    effort.settle(true);
    expect(learnedEffortLimit("deepseek-v4-flash")).toEqual({ drop: true, ceiling: undefined, replace: {} });
  });

  it("drops the parameter when the rejected level was already the lowest allowed", () => {
    const effort = state("some-new-lab-model", "low");
    expect(effort.heal(rejected("Unsupported value: 'low' for reasoning_effort"), "chat_completions")).toBe(true);
    expect(effort.level()).toBeUndefined();
  });

  it("heals once per run: a second rejection is the answer", () => {
    const effort = state();
    expect(effort.heal(rejected("Invalid value: 'ultra' for reasoning_effort"), "chat_completions")).toBe(true);
    expect(effort.heal(rejected("Invalid value: 'max' for reasoning_effort"), "chat_completions")).toBe(false);
    expect(effort.level()).toBe("max");
  });

  it("does not heal any other 400", () => {
    const effort = state();
    expect(effort.heal(rejected("This model's maximum context length is 1000 tokens."), "chat_completions")).toBe(false);
    expect(effort.heal(rejected("Invalid API key provided."), "chat_completions")).toBe(false);
    expect(effort.heal(rejected("The model `x` does not exist.", 404), "chat_completions")).toBe(false);
    expect(effort.level()).toBe("ultra");
    effort.settle(true);
    expect(learnedEffortLimit("deepseek-v4-flash")).toBeUndefined();
  });

  it("learns only the refused level when Off is refused, so a model that cannot be turned off keeps its levels", () => {
    const effort = createEffortState({
      modelId: "gemini-3.5-flash",
      requested: "none",
      explicit: true,
      wire: "google_generate_content",
      officialOpenAI: false,
    });
    expect(effort.level()).toBe("none");
    const refusal = { status: 400, body: JSON.stringify({ error: { code: 400, message: "Budget 0 is invalid. This model only works in thinking mode." } }) };
    expect(effort.heal(refusal, "google_generate_content")).toBe(true);
    expect(effort.level()).toBeUndefined();
    effort.settle(true);
    expect(learnedEffortLimit("gemini-3.5-flash")).toEqual({ drop: false, ceiling: undefined, replace: { none: "omit" } });
    const gemini = { wire: "google_generate_content" } as const;
    expect(planEffort("gemini-3.5-flash", { requested: "none", explicit: true }, gemini).level).toBeUndefined();
    expect(planEffort("gemini-3.5-flash", { requested: "high", explicit: true }, gemini).level).toBe("high");
  });

  it("learns only the refused level when a job's low is refused, and does not hold Chat at Off", () => {
    const effort = createEffortState({
      modelId: "deepseek-v4-flash",
      requested: "low",
      explicit: true,
      wire: "chat_completions",
      officialOpenAI: false,
    });
    expect(effort.heal(rejected("Unsupported value: 'low' for reasoning_effort"), "chat_completions")).toBe(true);
    expect(effort.level()).toBe("none");
    effort.settle(true);
    expect(learnedEffortLimit("deepseek-v4-flash")).toEqual({ drop: false, ceiling: undefined, replace: { low: "none" } });
    expect(planEffort("deepseek-v4-flash", { requested: "high", explicit: true }, COMPLETIONS).level).toBe("high");
  });

  it("learns where a tenant's refusals are kept: only for that tenant", () => {
    const effort = createEffortState({
      modelId: "deepseek-v4-flash",
      requested: "ultra",
      explicit: true,
      wire: "chat_completions",
      officialOpenAI: false,
      scope: "tenant-a",
    });
    effort.heal(rejected("Invalid value: 'ultra' for reasoning_effort"), "chat_completions");
    effort.settle(true);
    expect(learnedEffortLimit("deepseek-v4-flash", "tenant-a")?.ceiling).toBe("max");
    expect(learnedEffortLimit("deepseek-v4-flash", "tenant-b")).toBeUndefined();
    expect(learnedEffortLimit("deepseek-v4-flash")).toBeUndefined();
  });

  it("has nothing to heal when no effort was sent", () => {
    const effort = createEffortState({
      modelId: "some-new-lab-model",
      requested: "medium",
      explicit: false,
      wire: "chat_completions",
      officialOpenAI: false,
    });
    expect(effort.level()).toBeUndefined();
    expect(effort.heal(rejected("Unsupported parameter: 'reasoning_effort'"), "chat_completions")).toBe(false);
  });

  it("learns nothing when the retry did not answer either", () => {
    const effort = state();
    effort.heal(rejected("Invalid value: 'ultra' for reasoning_effort"), "chat_completions");
    effort.settle(false);
    expect(learnedEffortLimit("deepseek-v4-flash")).toBeUndefined();
    effort.settle(true);
    expect(learnedEffortLimit("deepseek-v4-flash")).toBeUndefined();
  });

  it("steps within the list of the wire in use when it fails, not the one it started on", () => {
    const effort = createEffortState({
      modelId: "claude-sonnet-5",
      requested: "ultra",
      explicit: true,
      wire: "anthropic_messages",
      officialOpenAI: false,
    });
    expect(effort.level()).toBe("max");
    // The Messages route was missing, the run fell back to Completions, and Completions refused max.
    expect(effort.heal(rejected("Unsupported value: 'max' for reasoning_effort"), "chat_completions")).toBe(true);
    expect(effort.level()).toBe("xhigh");
  });

  it("logs one redacted line: the model, what was asked, what was learned, and nothing else", () => {
    const effort = state("DeepSeek/DeepSeek-V4-Flash");
    effort.heal(
      {
        status: 400,
        body: JSON.stringify({
          error: {
            message: "Unsupported value: 'ultra' for reasoning_effort. prompt: my secret plan, key sk-live-abc123",
          },
        }),
      },
      "chat_completions",
    );
    expect(warn).not.toHaveBeenCalled();
    effort.settle(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain("deepseek-v4-flash");
    expect(line).toContain("ultra");
    expect(line).toContain("max");
    expect(line).not.toContain("sk-live");
    expect(line).not.toContain("secret plan");
    expect(line).not.toContain("DeepSeek/");
    expect(warn.mock.calls[0]).toHaveLength(1);
  });

  it("logs a failed retry the same way, with nothing learned", () => {
    const effort = state();
    effort.heal(rejected("Invalid value: 'ultra' for reasoning_effort"), "chat_completions");
    effort.settle(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/did not help/);
  });

  it("says nothing when nothing was healed", () => {
    const effort = state();
    effort.settle(true);
    effort.settle(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("neutralises an id that is not a plain model name before it reaches the log", () => {
    const effort = state("weird\nid with spaces/and\u0000-controls");
    effort.heal(rejected("Invalid value: 'ultra' for reasoning_effort"), "chat_completions");
    effort.settle(true);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line.split("\n")).toHaveLength(1);
    expect(line).not.toContain("\u0000");
  });
});
