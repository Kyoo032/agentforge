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

  it("ignores thinking parts in the visible transcript text", () => {
    expect(
      messageText([
        { type: "thinking", text: "plan" },
        { type: "text", text: "2 + 3 = 5" },
      ]),
    ).toBe("2 + 3 = 5");
  });
});
