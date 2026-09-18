import { describe, expect, it } from "vitest";
import { safeLinkHref } from "./safe-link";

describe("safeLinkHref", () => {
  it("keeps http and https links, normalised by the URL parser", () => {
    expect(safeLinkHref("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(safeLinkHref("http://example.com")).toBe("http://example.com/");
    expect(safeLinkHref("  HTTPS://Example.com  ")).toBe("https://example.com/");
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
    expect(safeLinkHref("   ")).toBeNull();
    expect(safeLinkHref("http://")).toBeNull();
  });

  it("renders the href the browser would follow, not the spelling the model wrote", () => {
    // Backslashes: every browser reads `https:\\evil.com` as `https://evil.com/`, so returning the
    // raw text showed the reader one destination and navigated them to another.
    expect(safeLinkHref("https:\\\\evil.com")).toBe("https://evil.com/");
    expect(safeLinkHref("https://EXAMPLE.com/a b")).toBe("https://example.com/a%20b");
    expect(safeLinkHref("https://example.com/a\tb")).toBe("https://example.com/ab");
    expect(safeLinkHref("https://example.com/../../etc/passwd")).toBe("https://example.com/etc/passwd");
  });

  it("shows an internationalised host as punycode, which is how it will be looked up", () => {
    // `раypal.com` is Cyrillic; the URL parser encodes it, so the href carries the `xn--` form and
    // the reader sees the same string the resolver will. Spotting a confusable *inside* a valid
    // punycode label is the browser's job (it has the locale and the address bar); this function's
    // job is to make sure the markup cannot claim one host and reach another.
    const href = safeLinkHref("https://раypal.com/login");
    expect(href).toContain("xn--");
    expect(href).toMatch(/^https:\/\//);
  });

  it("refuses a hostname with a character outside the LDH set", () => {
    // `url.hostname` is already punycode, so anything left outside `[a-z0-9.-]` is a host the
    // parser could not render as a real name: an IP literal in brackets, an underscore label, or
    // whatever a future parser quirk lets through.
    expect(safeLinkHref("http://[::1]/x")).toBeNull();
    expect(safeLinkHref("https://exa_mple.com")).toBeNull();
    expect(safeLinkHref("https://user:pass@exa_mple.com/x")).toBeNull();
  });

  it("keeps an ordinary host with digits, dots and dashes, including an IPv4 literal", () => {
    expect(safeLinkHref("https://sub-1.example.co.uk/x")).toBe("https://sub-1.example.co.uk/x");
    expect(safeLinkHref("http://127.0.0.1:3000/api")).toBe("http://127.0.0.1:3000/api");
  });
});
