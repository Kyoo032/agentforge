import { describe, expect, it } from "vitest";
import { applyJobThinking, jobThinkingExtras } from "./job-thinking";
import { isWatchdogReasoningModel } from "../runtime/stream-watchdog";
import { applyReasoningEffortToChatBody } from "./reasoning-effort";

describe("jobThinkingExtras", () => {
  it("asks every quiet family for its lowest effort and sends no vendor-only field", () => {
    // The gateway 400s on `thinking: {type: "disabled"}` (driven 2026-09-15), so effort is all we send.
    expect(jobThinkingExtras("deepseek-v4-flash", "finance")).toEqual({ reasoning_effort: "low" });
    expect(jobThinkingExtras("deepseek/deepseek-v4-pro", "documents")).toEqual({ reasoning_effort: "low" });
    expect(jobThinkingExtras("glm-5.3-flash", "presentations")).toEqual({ reasoning_effort: "low" });
    expect(jobThinkingExtras("kimi-k3", "legal")).toEqual({ reasoning_effort: "low" });
    expect(jobThinkingExtras("qwen3.8-max", "research")).toEqual({ reasoning_effort: "low" });
    for (const mode of ["finance", "documents", "market"] as const) {
      const extras = jobThinkingExtras("deepseek-v4-flash", mode) ?? {};
      expect(Object.keys(extras)).toEqual(["reasoning_effort"]);
    }
  });

  it("leaves Chat and the quiet-free models alone", () => {
    expect(jobThinkingExtras("deepseek-v4-flash", undefined)).toBeNull();
    expect(jobThinkingExtras("gpt-5.6-luna", "finance")).toBeNull();
    expect(jobThinkingExtras("claude-opus-5", "finance")).toBeNull();
    expect(jobThinkingExtras("glm-5.2-fast-preview", "presentations")).toBeNull();
  });

  it("covers every family the watchdog waits longer for", () => {
    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro", "glm-5.3", "glm-5.3-flash", "kimi-k3", "qwen3.8-max"]) {
      expect(isWatchdogReasoningModel(id)).toBe(true);
      expect(jobThinkingExtras(id, "finance")).not.toBeNull();
    }
  });

  it("hands back a fresh object so a caller cannot edit the table", () => {
    const first = jobThinkingExtras("deepseek-v4-flash", "finance");
    const second = jobThinkingExtras("deepseek-v4-flash", "finance");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

describe("applyJobThinking", () => {
  it("is exactly what a Finance request adds for deepseek-v4-flash", () => {
    // What the runtime builds today: the generic medium effort from the chat ladder.
    const body = applyReasoningEffortToChatBody(
      { model: "deepseek-v4-flash", stream: true, messages: [{ role: "user", content: "Q3 brief" }] },
      "medium",
    );
    expect(applyJobThinking(body, "deepseek-v4-flash", "finance")).toEqual({
      model: "deepseek-v4-flash",
      stream: true,
      messages: [{ role: "user", content: "Q3 brief" }],
      reasoning_effort: "low",
    });
  });

  it("keeps Chat's body byte for byte", () => {
    const body = applyReasoningEffortToChatBody({ model: "deepseek-v4-flash", stream: true }, "medium");
    expect(applyJobThinking(body, "deepseek-v4-flash", undefined)).toEqual({
      model: "deepseek-v4-flash",
      stream: true,
      reasoning_effort: "medium",
    });
  });

  it("never mutates the body it was given and ignores a non-object", () => {
    const body = { model: "deepseek-v4-flash", reasoning_effort: "medium" };
    const next = applyJobThinking(body, "deepseek-v4-flash", "market");
    expect(body).toEqual({ model: "deepseek-v4-flash", reasoning_effort: "medium" });
    expect(next).not.toBe(body);
    expect(applyJobThinking("not a body", "deepseek-v4-flash", "market")).toBe("not a body");
    expect(applyJobThinking(null, "deepseek-v4-flash", "market")).toBeNull();
  });
});
