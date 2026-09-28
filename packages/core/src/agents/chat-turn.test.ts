import { describe, expect, it } from "vitest";
import { bindingsForChatModality, repairUnresolvedCites, settleChatTurn } from "./chat-turn";

describe("Chat turn check", () => {
  it("drops a source number the desk did not offer and keeps one it did", () => {
    expect(repairUnresolvedCites("From the desk [1] [99].", 1, "en")).toBe("From the desk [1].");
  });

  it("says the desk had no such source when every marker was invented", () => {
    expect(repairUnresolvedCites("See [9].", 0, "en")).toBe("See.\n\nThis desk did not have a source for that.");
    expect(repairUnresolvedCites("Lihat [9].", 0, "id")).toContain("Meja ini tidak punya sumber untuk itu.");
  });

  it("leaves a marker inside a fence", () => {
    const text = "Before [1].\n```\n[99]\n```\nAfter.";
    expect(repairUnresolvedCites(text, 1, "en")).toBe(text);
  });

  it("writes the tool result when the reply has no sentence", () => {
    const settled = settleChatTurn({
      text: "",
      offeredSources: 0,
      locale: "en",
      tools: [
        {
          toolKey: "calculator",
          status: "completed",
          input: { expression: "2 + 3" },
          output: { result: 5 },
        },
      ],
    });
    expect(settled.text).toBe("2 + 3 = 5");
    expect(settled.appended).toBe("2 + 3 = 5");
  });

  it("names an earlier chat from the tool, in Bahasa Indonesia", () => {
    const settled = settleChatTurn({
      text: "   ",
      offeredSources: 0,
      locale: "id",
      tools: [
        {
          toolKey: "past_sessions",
          status: "completed",
          output: { success: true, sessions: [{ title: "Budget decision" }] },
        },
      ],
    });
    expect(settled.text).toBe('Percakapan sebelumnya berjudul "Budget decision".');
  });

  it("does not offer generate tools on an understand turn", () => {
    const bindings = [
      { toolKey: "calculator" },
      { toolKey: "image_generate" },
      { toolKey: "video_generate" },
      { toolKey: "past_sessions" },
    ];
    expect(bindingsForChatModality(bindings, "text").map((binding) => binding.toolKey)).toEqual([
      "calculator",
      "image_generate",
      "video_generate",
      "past_sessions",
    ]);
    expect(bindingsForChatModality(bindings, "image").map((binding) => binding.toolKey)).toEqual([
      "calculator",
      "past_sessions",
    ]);
    expect(bindingsForChatModality(bindings, "video").map((binding) => binding.toolKey)).toEqual([
      "calculator",
      "past_sessions",
    ]);
  });
});
