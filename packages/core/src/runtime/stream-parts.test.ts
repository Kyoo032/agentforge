import { describe, expect, it } from "vitest";
import { mapStreamPart } from "./stream-parts";

describe("mapStreamPart", () => {
  it("maps text-delta with textDelta or text", () => {
    expect(mapStreamPart({ type: "text-delta", textDelta: "Hi" })).toEqual({
      type: "assistant.delta",
      text: "Hi",
    });
    expect(mapStreamPart({ type: "text-delta", text: "Hi" })).toEqual({
      type: "assistant.delta",
      text: "Hi",
    });
  });

  it("maps reasoning so thinking is not dropped", () => {
    expect(mapStreamPart({ type: "reasoning", textDelta: "plan" })).toEqual({
      type: "assistant.thinking",
      text: "plan",
    });
  });

  it("maps tool calls and results", () => {
    expect(mapStreamPart({ type: "tool-call", toolName: "calculator", args: { expression: "1+1" } })).toEqual({
      type: "tool.started",
      toolKey: "calculator",
      input: { expression: "1+1" },
    });
    expect(mapStreamPart({ type: "tool-result", toolName: "calculator", result: { result: 2 } })).toEqual({
      type: "tool.completed",
      toolKey: "calculator",
      output: { result: 2 },
    });
  });

  it("maps stream errors instead of swallowing them", () => {
    expect(mapStreamPart({ type: "error", error: new Error("model 404") })).toEqual({
      type: "run.failed",
      message: "model 404",
    });
  });

  it("ignores empty deltas and unknown parts", () => {
    expect(mapStreamPart({ type: "text-delta", textDelta: "" })).toBeUndefined();
    expect(mapStreamPart({ type: "finish", finishReason: "stop" })).toBeUndefined();
  });
});
