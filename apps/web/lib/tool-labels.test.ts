import { describe, expect, it } from "vitest";
import { showsToolActivity, toolActivityLabel } from "./tool-labels";

describe("tool-labels", () => {
  it("hides activity for fast silent tools", () => {
    expect(showsToolActivity("calculator")).toBe(false);
    expect(showsToolActivity("datetime")).toBe(false);
  });

  it("shows activity for slower or visible tools", () => {
    expect(showsToolActivity("web_search")).toBe(true);
    expect(showsToolActivity("image_generate")).toBe(true);
    expect(showsToolActivity("video_generate")).toBe(true);
  });

  it("uses plain-language activity labels", () => {
    expect(toolActivityLabel("web_search")).toBe("Searching…");
    expect(toolActivityLabel("image_generate")).toBe("Creating image…");
    expect(toolActivityLabel("video_generate")).toBe("Creating video…");
    expect(toolActivityLabel("past_sessions")).toBe("Looking up past chats…");
    expect(toolActivityLabel("custom_pack_tool")).toBe("Working…");
  });
});
