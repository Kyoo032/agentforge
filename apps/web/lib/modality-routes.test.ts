import { describe, expect, it } from "vitest";
import { parseImageRunInput, parseTextRunInput } from "@agentforge/core";

describe("modality routes reject the wrong payload", () => {
  it("rejects image parts on text", () => {
    expect(() =>
      parseTextRunInput({
        content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }],
      }),
    ).toThrowError(/not supported/);
  });

  it("rejects text-only image runs", () => {
    expect(() => parseImageRunInput({ content: [{ type: "text", text: "hi" }] })).toThrow();
  });
});
