import { describe, expect, it } from "vitest";
import { showsToolActivity, showsToolSpinner, toolActivityLabel, toolCallSummary } from "./tool-labels";

describe("tool-labels", () => {
  it("shows every tool in the transcript, with a compact spinner for calculator", () => {
    expect(showsToolActivity("calculator")).toBe(true);
    expect(showsToolSpinner("calculator")).toBe(false);
    expect(showsToolSpinner("web_search")).toBe(true);
  });

  it("uses plain-language activity labels", () => {
    expect(toolActivityLabel("web_search")).toBe("Searching…");
    expect(toolActivityLabel("image_generate")).toBe("Creating image…");
    expect(toolActivityLabel("video_generate")).toBe("Creating video…");
    expect(toolActivityLabel("past_sessions")).toBe("Looking up past chats…");
    expect(toolActivityLabel("custom_pack_tool")).toBe("Working…");
  });

  it("summarizes calculator input and output", () => {
    expect(toolCallSummary("calculator", { expression: "2 + 3" }, { result: 5 })).toBe(
      "Calculator · 2 + 3 → 5",
    );
  });
});
