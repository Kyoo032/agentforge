/**
 * The cross-site-scripting audit for everything a model writes into the page.
 *
 * Every mode's prose — chat turns, research notes, documents, presentation bullets, finance and
 * legal views — reaches the reader through `FormattedText`, which parses markdown into the AST in
 * `parse-markdown.ts` and renders it as React elements. There is no HTML string anywhere on that
 * path: no `dangerouslySetInnerHTML`, no `innerHTML`, no `srcdoc`. This suite renders the component
 * for real (`renderToStaticMarkup`) against the payloads an attacker would try, and pins that each
 * one comes out as visible text rather than as a tag, an event handler, or a navigable scheme.
 *
 * `html-sinks.test.ts` is the other half: it keeps a future edit from reintroducing a sink.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormattedText } from "@/components/formatted-text";

function render(text: string): string {
  return renderToStaticMarkup(<FormattedText text={text} />);
}

function renderInline(text: string): string {
  return renderToStaticMarkup(<FormattedText text={text} inline />);
}

/** No tag the browser would act on, in either the block or the inline renderer. */
function expectInert(text: string): string {
  const markup = render(text);
  for (const opener of ["<img", "<script", "<iframe", "<object", "<embed", "<form", "<svg", "<style", "<link"]) {
    expect(markup.toLowerCase()).not.toContain(opener);
    expect(renderInline(text).toLowerCase()).not.toContain(opener);
  }
  // React escapes a quote in text to `&quot;`, so a bare `="` in the markup can only be a real
  // attribute. Neither a scripting scheme nor an iframe document may ever appear as one.
  expect(markup).not.toMatch(/=\s*"\s*(javascript|vbscript|data):/i);
  expect(markup).not.toContain('srcdoc="');
  expect(markup).not.toMatch(/\son[a-z]+\s*=\s*"/i);
  return markup;
}

describe("raw HTML in model output", () => {
  it("renders an onerror image payload as text", () => {
    const markup = expectInert("<img src=x onerror=alert(1)>");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders a script element as text", () => {
    const markup = expectInert("<script>alert(1)</script>");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders a sandboxed-looking iframe with srcdoc as text", () => {
    const markup = expectInert(`<iframe srcdoc="<script>alert(1)</script>"></iframe>`);
    expect(markup).toContain("&lt;iframe");
  });

  it("renders object, embed, form and svg payloads as text", () => {
    expectInert("<object data=javascript:alert(1)></object>");
    expectInert("<embed src=javascript:alert(1)>");
    expectInert(`<form action="/x"><input name=a></form>`);
    expectInert("<svg onload=alert(1)></svg>");
  });

  it("renders an anchor written as HTML as text, not as a link", () => {
    const markup = expectInert(`<a href="javascript:alert(1)">click</a>`);
    expect(markup).not.toContain("<a ");
    expect(markup).toContain("&lt;a href=");
  });

  it("keeps a payload inert inside a heading, a list, a quote and a table cell", () => {
    expectInert("# <img src=x onerror=alert(1)>");
    expectInert("- <script>alert(1)</script>");
    expectInert("> <img src=x onerror=alert(1)>");
    expectInert("| a | b |\n| --- | --- |\n| <script>alert(1)</script> | x |");
    expectInert("```\n<script>alert(1)</script>\n```");
  });
});

describe("link schemes in model output", () => {
  it("drops a javascript: link and keeps its label as plain text", () => {
    const markup = expectInert("[x](javascript:alert(1))");
    expect(markup).toContain("x");
    expect(markup).not.toContain("href");
  });

  it("drops javascript: however it is spelled", () => {
    for (const href of [
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)  ",
      "javascript:alert(1)",
      "vbscript:alert(1)",
      "file:///etc/passwd",
    ]) {
      const markup = render(`[x](${href})`);
      expect(markup).not.toContain("href");
    }
  });

  it("drops a data: link, including one that carries HTML", () => {
    expect(render("[x](data:text/html,<script>alert(1)</script>)")).not.toContain("href");
    expect(render("[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)")).not.toContain("href");
  });

  it("drops a protocol-relative link, which would leave our own scheme behind", () => {
    expect(render("[x](//evil.example/a)")).not.toContain("href");
  });

  it("keeps an http(s) link, opens it in a new tab, and severs the opener and the referrer", () => {
    const markup = render("[docs](https://example.com/a?b=1)");
    expect(markup).toContain('href="https://example.com/a?b=1"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('target="_blank"');
  });
});

describe("image sources in model output", () => {
  it("never auto-loads a remote image; it degrades to a link the reader must click", () => {
    const markup = render("![cat](https://cdn.evil.example/beacon.gif)");
    expect(markup).not.toContain("<img");
    expect(markup).toContain('href="https://cdn.evil.example/beacon.gif"');
  });

  it("refuses an SVG data URL, which is a script container", () => {
    const markup = render("![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain('src="data:image/svg');
  });

  it("refuses a javascript: image source", () => {
    expectInert("![x](javascript:alert(1))");
  });

  it("loads host-served media and inline raster data URLs", () => {
    expect(render("![cat](/api/v1/media/abc/file)")).toContain('<img src="/api/v1/media/abc/file"');
    expect(render("![cat](data:image/png;base64,iVBORw0KGgo=)")).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });
});

describe("edge cases", () => {
  it("renders empty and whitespace text without producing any element", () => {
    expect(render("")).toBe('<div class="formatted-md"></div>');
    expect(render("   \n\n  ")).toBe('<div class="formatted-md"></div>');
  });

  it("escapes quotes, ampersands and angle brackets rather than closing an attribute", () => {
    const markup = render(`a " onmouseover="alert(1)" b & c < d`);
    expect(markup).not.toContain('onmouseover="alert(1)"');
    expect(markup).toContain("&amp;");
  });

  it("keeps unicode and emoji intact", () => {
    expect(render("halo dunia 🇮🇩 — ünïcode")).toContain("halo dunia 🇮🇩 — ünïcode");
  });

  it("stays inert on a long hostile document", () => {
    expectInert(Array.from({ length: 200 }, () => "<img src=x onerror=alert(1)>").join("\n\n"));
  });
});
