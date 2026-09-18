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

/**
 * The reasoning-leak guard. An OpenAI-style reasoning summary ("**Clarifying source needs**\n\n…")
 * reads exactly like an answer, so if a single reasoning part were ever mapped to
 * `assistant.delta` it would be streamed to the reader and persisted as the reply's `text` part —
 * silently, with nothing in the transcript to say it was not the answer. These fixtures replay
 * whole streams and assert the two channels never mix.
 */
function replay(parts: unknown[]): { text: string; thinking: string } {
  let text = "";
  let thinking = "";
  for (const part of parts) {
    const event = mapStreamPart(part);
    if (event?.type === "assistant.delta") {
      text += event.text;
    }
    if (event?.type === "assistant.thinking") {
      thinking += event.text;
    }
  }
  return { text, thinking };
}

const SUMMARY_HEAD = "**Clarifying source needs**";

describe("reasoning never reaches the reply", () => {
  it("keeps a chat-completions `reasoning` summary out of the text channel", () => {
    // Shape 1: the gateway streams the summary as its own part type, interleaved with the answer.
    const { text, thinking } = replay([
      { type: "step-start" },
      { type: "reasoning", textDelta: `${SUMMARY_HEAD}\n\n` },
      { type: "reasoning", textDelta: "I need to figure out the best way to answer." },
      { type: "text-delta", textDelta: "This is a local desk app." },
      { type: "finish", finishReason: "stop" },
    ]);
    expect(text).toBe("This is a local desk app.");
    expect(text).not.toContain(SUMMARY_HEAD);
    expect(thinking).toContain(SUMMARY_HEAD);
  });

  it("keeps a responses-wire `reasoning-delta` summary out of the text channel", () => {
    // Shape 2: the /v1/responses wire, where `reasoning_summary` arrives as `reasoning-delta`
    // and the answer text can start before the summary has finished.
    const { text, thinking } = replay([
      { type: "reasoning-start", id: "rs_1" },
      { type: "reasoning-delta", text: SUMMARY_HEAD },
      { type: "text-delta", text: "DPSBuddy" },
      { type: "reasoning-delta", text: "\n\nThe user asks what the product is." },
      { type: "text-delta", text: " is a local desk." },
      { type: "reasoning-end", id: "rs_1" },
    ]);
    expect(text).toBe("DPSBuddy is a local desk.");
    expect(thinking).toBe(`${SUMMARY_HEAD}\n\nThe user asks what the product is.`);
  });

  it("never turns a reasoning part into assistant text, whichever field carries it", () => {
    for (const type of ["reasoning", "reasoning-delta"]) {
      for (const field of ["textDelta", "text", "delta"]) {
        expect(mapStreamPart({ type, [field]: SUMMARY_HEAD })).toEqual({
          type: "assistant.thinking",
          text: SUMMARY_HEAD,
        });
      }
    }
  });

  it("does not strip a bold heading the model meant as the answer", () => {
    // The conservative half of the rule: a real reply may legitimately open with a bold heading,
    // and nothing here is allowed to guess that away.
    const { text, thinking } = replay([{ type: "text-delta", textDelta: `${SUMMARY_HEAD}\n\nBody.` }]);
    expect(text).toBe(`${SUMMARY_HEAD}\n\nBody.`);
    expect(thinking).toBe("");
  });
});
