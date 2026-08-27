import { describe, expect, it } from "vitest";
import {
  classifyAttachment,
  isRenderableImageUrl,
  isRenderableVideoUrl,
  routeDecision,
} from "./composer-attach";

describe("classifyAttachment", () => {
  it("classifies image MIME types", () => {
    expect(classifyAttachment({ name: "a.png", type: "image/png" })).toBe("image");
    expect(classifyAttachment({ name: "a.jpg", type: "image/jpeg" })).toBe("image");
    expect(classifyAttachment({ name: "a.webp", type: "image/webp" })).toBe("image");
    expect(classifyAttachment({ name: "a.gif", type: "image/gif" })).toBe("image");
  });

  it("classifies video MIME types", () => {
    expect(classifyAttachment({ name: "a.mp4", type: "video/mp4" })).toBe("video");
    expect(classifyAttachment({ name: "a.webm", type: "video/webm" })).toBe("video");
    expect(classifyAttachment({ name: "a.mov", type: "video/quicktime" })).toBe("video");
  });

  it("classifies text by MIME or extension", () => {
    expect(classifyAttachment({ name: "notes.txt", type: "text/plain" })).toBe("text");
    expect(classifyAttachment({ name: "doc.md", type: "text/markdown" })).toBe("text");
    expect(classifyAttachment({ name: "data.csv", type: "text/csv" })).toBe("text");
    expect(classifyAttachment({ name: "payload.json", type: "application/json" })).toBe("text");
    expect(classifyAttachment({ name: "readme.MD", type: "" })).toBe("text");
    expect(classifyAttachment({ name: "sheet.csv", type: "application/octet-stream" })).toBe("text");
  });

  it("marks unknown types unsupported", () => {
    expect(classifyAttachment({ name: "a.pdf", type: "application/pdf" })).toBe("unsupported");
    expect(classifyAttachment({ name: "a.bin", type: "application/octet-stream" })).toBe("unsupported");
  });
});

describe("routeDecision", () => {
  it("routes empty or text-only to text", () => {
    expect(routeDecision([])).toEqual({ route: "text" });
    expect(routeDecision(["text"])).toEqual({ route: "text" });
    expect(routeDecision(["text", "text"])).toEqual({ route: "text" });
  });

  it("routes images (with optional text files) to image", () => {
    expect(routeDecision(["image"])).toEqual({ route: "image" });
    expect(routeDecision(["image", "image"])).toEqual({ route: "image" });
    expect(routeDecision(["text", "image"])).toEqual({ route: "image" });
  });

  it("routes video (with optional text files) to video", () => {
    expect(routeDecision(["video"])).toEqual({ route: "video" });
    expect(routeDecision(["text", "video"])).toEqual({ route: "video" });
  });

  it("errors when image and video are mixed", () => {
    expect(routeDecision(["image", "video"])).toEqual({
      route: "error",
      message: "Send image and video attachments separately",
    });
  });

  it("errors on unsupported kinds", () => {
    expect(routeDecision(["unsupported"])).toEqual({
      route: "error",
      message: "Unsupported file type",
    });
    expect(routeDecision(["text", "unsupported"])).toEqual({
      route: "error",
      message: "Unsupported file type",
    });
  });
});

describe("isRenderableMediaUrl", () => {
  it("accepts absolute, data, and relative media URLs for images", () => {
    expect(isRenderableImageUrl("https://cdn.example/a.png")).toBe(true);
    expect(isRenderableImageUrl("http://127.0.0.1/a.png")).toBe(true);
    expect(isRenderableImageUrl("data:image/png;base64,aaa")).toBe(true);
    expect(isRenderableImageUrl("/api/v1/media/abc/file")).toBe(true);
    expect(isRenderableImageUrl("ftp://x")).toBe(false);
    expect(isRenderableImageUrl("/other/path")).toBe(false);
  });

  it("accepts absolute, data, and relative media URLs for videos", () => {
    expect(isRenderableVideoUrl("https://cdn.example/a.mp4")).toBe(true);
    expect(isRenderableVideoUrl("http://127.0.0.1/a.mp4")).toBe(true);
    expect(isRenderableVideoUrl("data:video/mp4;base64,aaa")).toBe(true);
    expect(isRenderableVideoUrl("/api/v1/media/abc/file")).toBe(true);
    expect(isRenderableVideoUrl("data:image/png;base64,aaa")).toBe(false);
    expect(isRenderableVideoUrl("/other/path")).toBe(false);
  });
});
