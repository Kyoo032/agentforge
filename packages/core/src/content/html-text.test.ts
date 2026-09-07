import { describe, expect, it } from "vitest";
import { capText, decodeEntities, extractHtmlTitle, htmlToText, isHtmlContent, plainToText } from "./html-text";

const PAGE = `<!doctype html><html><head><title>Lithium &amp; recycling &mdash; report</title>
<style>.x{color:red}</style><script>alert(1)</script></head>
<body><nav><a href="/">Home</a> Menu</nav><header>Site header</header>
<main><h1>Recycling economics</h1><p>Margins reached <b>12%</b> in 2025.</p>
<ul><li>Point one</li><li>Point &lt;two&gt;</li></ul>
<p>${"Body sentence. ".repeat(20)}</p></main>
<aside>Related links</aside><footer>Footer text</footer></body></html>`;

describe("htmlToText", () => {
  it("keeps main content and drops chrome, scripts, and styles", () => {
    const out = htmlToText(PAGE);
    expect(out.title).toBe("Lithium & recycling — report");
    expect(out.text).toContain("Recycling economics\n\nMargins reached 12% in 2025.");
    expect(out.text).toMatch(/Point one\n+Point <two>/);
    for (const gone of ["alert(1)", "color:red", "Home", "Site header", "Related links", "Footer text"]) {
      expect(out.text).not.toContain(gone);
    }
    expect(out.truncated).toBe(false);
  });

  it("caps at a sentence or line break and marks truncation", () => {
    const out = htmlToText(PAGE, { maxChars: 120 });
    expect(out.truncated).toBe(true);
    expect(out.text.endsWith("[truncated]")).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(120 + "\n[truncated]".length);
    expect(capText("abc", 10)).toEqual({ text: "abc", truncated: false });
  });

  it("picks the largest article when a page has several", () => {
    const teaser = `<article><p>${"Teaser card text. ".repeat(15)}</p></article>`;
    const real = `<article><h2>Real story</h2><p>${"Real body sentence. ".repeat(40)}</p></article>`;
    const out = htmlToText(`<html><body>${teaser}${real}</body></html>`);
    expect(out.text.startsWith("Real story")).toBe(true);
    expect(out.text).not.toContain("Teaser card");
  });

  it("falls back to body and h1 when there is no main or title", () => {
    const out = htmlToText("<html><body><h1>Only heading</h1><div>text here</div></body></html>");
    expect(out.title).toBe("Only heading");
    expect(out.text).toBe("Only heading\n\ntext here");
    expect(extractHtmlTitle("<p>no title</p>")).toBe("");
  });

  it("decodes entities and detects html", () => {
    expect(decodeEntities("a &#169; b &#x41; &nbsp;c &unknown;")).toBe("a © b A  c &unknown;");
    expect(decodeEntities("bad &#99999999; &#xFFFFFFFF; &#xD800; ok")).toBe("bad &#99999999; &#xFFFFFFFF; &#xD800; ok");
    expect(isHtmlContent("text/html; charset=utf-8", "")).toBe(true);
    expect(isHtmlContent("", "<div>x</div>")).toBe(true);
    expect(isHtmlContent("text/plain", "<!DOCTYPE html><html>x</html>")).toBe(true);
    expect(isHtmlContent("text/plain", "just text with a < sign")).toBe(false);
    expect(isHtmlContent("text/css", "<div>x</div>")).toBe(false);
    expect(plainToText("  a  \n\n\n b ", { maxChars: 100 })).toEqual({ title: "", text: "a\n\nb", truncated: false });
  });
});
