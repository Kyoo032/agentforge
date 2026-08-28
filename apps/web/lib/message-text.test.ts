import { describe, expect, it } from "vitest";
import { messageText } from "./message-text";

describe("messageText", () => {
  it("reads plain strings", () => {
    expect(messageText("  hello  ")).toBe("hello");
  });

  it("joins text parts", () => {
    expect(
      messageText([
        { type: "text", text: "Line one" },
        { type: "text", text: "Line two" },
      ]),
    ).toBe("Line one\nLine two");
  });

  it("ignores non-text parts", () => {
    expect(messageText([{ type: "image_url", image_url: { url: "https://example.com/a.png" } }])).toBe("");
  });
});
