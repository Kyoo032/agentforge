import { describe, expect, it } from "vitest";
import {
  applyMinimaxRequest,
  isMinimaxChatModel,
  normalizeMinimaxDelta,
  normalizeMinimaxPayload,
  rewriteMinimaxSseChunk,
  splitThinkTags,
} from "./minimax-compat";

describe("isMinimaxChatModel", () => {
  it("matches MiniMax chat ids including gateway leaves", () => {
    expect(isMinimaxChatModel("minimax-m3")).toBe(true);
    expect(isMinimaxChatModel("MiniMax-M3")).toBe(true);
    expect(isMinimaxChatModel("minimax/minimax-m3")).toBe(true);
    expect(isMinimaxChatModel("gpt-5.6-sol")).toBe(false);
    expect(isMinimaxChatModel("")).toBe(false);
  });
});

describe("applyMinimaxRequest", () => {
  it("injects reasoning_split for MiniMax and leaves other models alone", () => {
    expect(applyMinimaxRequest({ model: "minimax-m3", messages: [] })).toEqual({
      model: "minimax-m3",
      messages: [],
      reasoning_split: true,
    });
    const gpt = { model: "gpt-5.6-sol", messages: [] };
    expect(applyMinimaxRequest(gpt)).toBe(gpt);
  });

  it("does not override an explicit reasoning_split", () => {
    expect(applyMinimaxRequest({ model: "minimax-m3", reasoning_split: false })).toEqual({
      model: "minimax-m3",
      reasoning_split: false,
    });
  });
});

describe("splitThinkTags", () => {
  it("splits think blocks from the visible answer", () => {
    expect(splitThinkTags("<think>plan</think>\nHello")).toEqual({ thinking: "plan", visible: "Hello" });
  });

  it("treats unclosed think as thinking", () => {
    expect(splitThinkTags("<think>still going")).toEqual({ thinking: "still going", visible: "" });
  });
});

describe("normalizeMinimaxDelta", () => {
  it("copies reasoning_content into content when content is empty", () => {
    expect(normalizeMinimaxDelta({ reasoning_content: "The sky is blue.", content: null }).content).toBe(
      "The sky is blue.",
    );
  });

  it("flattens reasoning_details arrays", () => {
    expect(
      normalizeMinimaxDelta({
        content: "",
        reasoning_details: [{ text: "step one " }, { text: "step two" }],
      }).content,
    ).toBe("step one step two");
  });

  it("keeps the answer in content and strips think tags", () => {
    const next = normalizeMinimaxDelta({ content: "<think>scratch</think>\nShip it." });
    expect(next.content).toBe("Ship it.");
    expect(next.reasoning_content).toBe("scratch");
  });
});

describe("normalizeMinimaxPayload", () => {
  it("rewrites stream choice deltas", () => {
    const payload = {
      choices: [{ delta: { reasoning_content: "Hello from MiniMax", content: null } }],
    };
    const next = normalizeMinimaxPayload(payload) as { choices: Array<{ delta: { content: string } }> };
    expect(next.choices[0]?.delta.content).toBe("Hello from MiniMax");
  });
});

describe("rewriteMinimaxSseChunk", () => {
  it("rewrites complete SSE data lines", () => {
    const chunk =
      'data: {"choices":[{"delta":{"reasoning_details":[{"text":"Hi"}],"content":null}}]}\n';
    const out = rewriteMinimaxSseChunk(chunk);
    expect(out).toContain('"content":"Hi"');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("leaves [DONE] and incomplete lines alone", () => {
    expect(rewriteMinimaxSseChunk("data: [DONE]\n")).toBe("data: [DONE]\n");
    expect(rewriteMinimaxSseChunk('data: {"choices"')).toBe('data: {"choices"');
  });
});
