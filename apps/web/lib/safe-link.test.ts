import { describe, expect, it } from "vitest";
import { safeLinkHref } from "./safe-link";

describe("safeLinkHref", () => {
  it("keeps http and https links", () => {
    expect(safeLinkHref("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(safeLinkHref("http://example.com")).toBe("http://example.com");
    expect(safeLinkHref("  HTTPS://Example.com  ")).toBe("HTTPS://Example.com");
  });

  it("returns null for every other scheme so the renderer falls back to plain text", () => {
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("JAVASCRIPT:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html,x")).toBeNull();
    expect(safeLinkHref("vbscript:x")).toBeNull();
    expect(safeLinkHref("file:///etc/passwd")).toBeNull();
    expect(safeLinkHref("mailto:a@b.c")).toBeNull();
    expect(safeLinkHref("//example.com")).toBeNull();
    expect(safeLinkHref("/relative")).toBeNull();
    expect(safeLinkHref("")).toBeNull();
    expect(safeLinkHref("http://")).toBeNull();
  });
});
