import { describe, expect, it } from "vitest";
import { appendRegenInstruction, readJobRegenAttachments, readOptionalInstruction } from "./job-regen";

describe("readOptionalInstruction", () => {
  it("trims a string instruction and ignores missing values", () => {
    expect(readOptionalInstruction({ instruction: "  shorter  " })).toBe("shorter");
    expect(readOptionalInstruction({ instruction: "" })).toBe("");
    expect(readOptionalInstruction({ prompt: "topic" })).toBe("");
    expect(readOptionalInstruction(null)).toBe("");
  });
});

describe("appendRegenInstruction", () => {
  it("appends only when the user typed guidance", () => {
    expect(appendRegenInstruction("Rewrite this section.", "")).toBe("Rewrite this section.");
    expect(appendRegenInstruction("Rewrite this section.", "Make it punchier")).toBe(
      "Rewrite this section.\n\nUser instruction:\nMake it punchier",
    );
  });
});

describe("readJobRegenAttachments", () => {
  it("returns an empty list when omitted", () => {
    expect(readJobRegenAttachments({})).toEqual([]);
    expect(readJobRegenAttachments({ attachments: null })).toEqual([]);
  });

  it("accepts image_url parts with local media or https urls", () => {
    expect(
      readJobRegenAttachments({
        attachments: [
          { type: "image_url", image_url: { url: "/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file" } },
          { type: "image_url", image_url: { url: "https://cdn.example/slide.png", detail: "low" } },
        ],
      }),
    ).toEqual([
      {
        type: "image_url",
        image_url: { url: "/api/v1/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/file", detail: "high" },
      },
      { type: "image_url", image_url: { url: "https://cdn.example/slide.png", detail: "low" } },
    ]);
  });

  it("rejects non-arrays and non-image parts", () => {
    expect(() => readJobRegenAttachments({ attachments: "nope" })).toThrow(/attachments must be an array/);
    expect(() =>
      readJobRegenAttachments({
        attachments: [{ type: "video_url", video_url: { url: "https://cdn.example/a.mp4" } }],
      }),
    ).toThrow(/image_url/);
  });
});
