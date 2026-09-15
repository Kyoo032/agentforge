import { describe, expect, it } from "vitest";
import { isRenderableImageUrl, isRenderableVideoUrl } from "./renderable-media";

describe("isRenderableImageUrl", () => {
  it("accepts host-served media paths", () => {
    expect(isRenderableImageUrl("/api/v1/media/abc/file")).toBe(true);
    expect(isRenderableImageUrl("agentforge://media/abc-123")).toBe(true);
  });

  it("accepts the four inline image data types", () => {
    for (const subtype of ["png", "jpeg", "webp", "gif"]) {
      expect(isRenderableImageUrl(`data:image/${subtype};base64,aaa`)).toBe(true);
      expect(isRenderableImageUrl(`data:image/${subtype},aaa`)).toBe(true);
    }
  });

  it("rejects remote http(s) urls so model output cannot steer the renderer", () => {
    expect(isRenderableImageUrl("https://cdn.example/a.png")).toBe(false);
    expect(isRenderableImageUrl("http://cdn.example/a.png")).toBe(false);
    expect(isRenderableImageUrl("http://127.0.0.1/a.png")).toBe(false);
    expect(isRenderableImageUrl("//cdn.example/a.png")).toBe(false);
  });

  it("rejects data urls outside the image allow-list", () => {
    expect(isRenderableImageUrl("data:image/svg+xml;base64,aaa")).toBe(false);
    expect(isRenderableImageUrl("data:text/html;base64,aaa")).toBe(false);
    expect(isRenderableImageUrl("data:image/pngx;base64,aaa")).toBe(false);
    expect(isRenderableImageUrl("data:image/png")).toBe(false);
  });

  it("rejects other schemes and unrelated paths", () => {
    expect(isRenderableImageUrl("ftp://x")).toBe(false);
    expect(isRenderableImageUrl("javascript:alert(1)")).toBe(false);
    expect(isRenderableImageUrl("agentforge://file/etc/passwd")).toBe(false);
    expect(isRenderableImageUrl("/other/path")).toBe(false);
    expect(isRenderableImageUrl("")).toBe(false);
  });
});

describe("isRenderableVideoUrl", () => {
  it("accepts host-served media paths", () => {
    expect(isRenderableVideoUrl("/api/v1/media/abc/file")).toBe(true);
    expect(isRenderableVideoUrl("agentforge://media/abc-123")).toBe(true);
  });

  it("rejects remote urls and every data url", () => {
    expect(isRenderableVideoUrl("https://cdn.example/a.mp4")).toBe(false);
    expect(isRenderableVideoUrl("http://127.0.0.1/a.mp4")).toBe(false);
    expect(isRenderableVideoUrl("data:video/mp4;base64,aaa")).toBe(false);
    expect(isRenderableVideoUrl("data:image/png;base64,aaa")).toBe(false);
    expect(isRenderableVideoUrl("/other/path")).toBe(false);
  });
});
