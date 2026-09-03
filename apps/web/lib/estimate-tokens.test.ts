import { describe, expect, it } from "vitest";
import { estimateConversationTokens, estimateTokensFromText, textFromMessageContent } from "./estimate-tokens";

describe("estimate tokens", () => {
  it("counts empty text as zero", () => {
    expect(estimateTokensFromText("")).toBe(0);
    expect(estimateTokensFromText("   ")).toBe(0);
  });

  it("uses about four characters per token", () => {
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcdefgh")).toBe(2);
  });

  it("reads text and thinking parts, not tool payloads", () => {
    expect(
      textFromMessageContent([
        { type: "text", text: "hello" },
        { type: "thinking", text: "plan" },
        { type: "tool_call", toolKey: "calculator", input: { huge: true } },
      ]),
    ).toBe("hello\nplan");
  });

  it("sums the thread plus live extras", () => {
    expect(
      estimateConversationTokens([{ content: [{ type: "text", text: "abcd" }] }], ["efgh"]),
    ).toBe(2);
  });
});
