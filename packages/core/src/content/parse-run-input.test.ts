import { describe, expect, it } from "vitest";
import { ContentParseError } from "../errors";
import { parseImageRunInput, parseTextRunInput, parseVideoRunInput } from "./parse-run-input";

describe("parseTextRunInput", () => {
  it("accepts a plain string", () => {
    const result = parseTextRunInput({ content: "Explain midterm week for CS101" });
    expect(result.parts).toEqual([{ type: "text", text: "Explain midterm week for CS101" }]);
    expect(result.stream).toBe(true);
  });

  it("accepts Hermes text parts", () => {
    const result = parseTextRunInput({
      content: [{ type: "text", text: "Hello" }],
      stream: false,
    });
    expect(result.parts).toEqual([{ type: "text", text: "Hello" }]);
    expect(result.stream).toBe(false);
  });

  it("rejects image_url on the text route", () => {
    expect(() =>
      parseTextRunInput({
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
        ],
      }),
    ).toThrow(ContentParseError);
    try {
      parseTextRunInput({
        content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ContentParseError);
      expect((error as ContentParseError).code).toBe("unsupported_content_type");
    }
  });

  it("rejects file parts", () => {
    expect(() => parseTextRunInput({ content: [{ type: "file", file: {} }] })).toThrowError(
      /not supported/,
    );
  });
});

describe("parseImageRunInput", () => {
  it("requires at least one image_url", () => {
    try {
      parseImageRunInput({ content: [{ type: "text", text: "only text" }] });
      throw new Error("expected throw");
    } catch (error) {
      expect((error as ContentParseError).code).toBe("invalid_content_part");
    }
  });

  it("accepts text plus image_url", () => {
    const result = parseImageRunInput({
      content: [
        { type: "text", text: "What is on this lecture slide?" },
        { type: "image_url", image_url: { url: "https://example.com/slide.png", detail: "high" } },
      ],
    });
    expect(result.parts).toHaveLength(2);
    expect(result.parts[1]).toMatchObject({ type: "image_url" });
  });

  it("accepts relative media URLs", () => {
    const result = parseImageRunInput({
      content: [{ type: "image_url", image_url: { url: "/api/v1/media/abc/file" } }],
    });
    expect(result.parts[0]).toMatchObject({ type: "image_url" });
  });

  it("rejects video_url on the image route", () => {
    try {
      parseImageRunInput({
        content: [{ type: "video_url", video_url: { url: "https://example.com/a.mp4" } }],
      });
    } catch (error) {
      expect((error as ContentParseError).code).toBe("unsupported_content_type");
      return;
    }
    throw new Error("expected throw");
  });

  it("rejects non-image data URLs", () => {
    try {
      parseImageRunInput({
        content: [{ type: "image_url", image_url: { url: "data:application/pdf;base64,aaa" } }],
      });
    } catch (error) {
      expect((error as ContentParseError).code).toBe("unsupported_content_type");
      return;
    }
    throw new Error("expected throw");
  });
});

describe("parseVideoRunInput", () => {
  it("requires a video_url part", () => {
    try {
      parseVideoRunInput({
        content: [{ type: "text", text: "Summarize this lab demo" }],
      });
    } catch (error) {
      expect((error as ContentParseError).code).toBe("invalid_content_part");
      return;
    }
    throw new Error("expected throw");
  });

  it("accepts text plus video_url", () => {
    const result = parseVideoRunInput({
      content: [
        { type: "text", text: "Summarize this lab demo" },
        { type: "video_url", video_url: { url: "https://example.com/demo.mp4" } },
      ],
    });
    expect(result.parts.some((part) => part.type === "video_url")).toBe(true);
  });

  it("rejects image_url on the video route", () => {
    try {
      parseVideoRunInput({
        content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }],
      });
    } catch (error) {
      expect((error as ContentParseError).code).toBe("unsupported_content_type");
      return;
    }
    throw new Error("expected throw");
  });
});
