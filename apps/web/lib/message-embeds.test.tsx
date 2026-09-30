import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormattedText } from "@/components/formatted-text";
import { NultronMascot } from "@/components/nultron/nultron-mascot";
import {
  classifyStandaloneHref,
  jobEmbedsFromOutput,
  presentStandaloneLink,
  splitUserFileBlocks,
} from "./message-embeds";

describe("standalone link cards", () => {
  it("keeps an ordinary https link as a link card", () => {
    const card = presentStandaloneLink("https://example.com/a?b=1", "docs");
    expect(card).toMatchObject({ kind: "link", title: "docs", href: "https://example.com/a?b=1" });
  });

  it("refuses a javascript link", () => {
    expect(presentStandaloneLink("javascript:alert(1)", "x")).toBeNull();
  });

  it("treats a file extension as a file and a job path as a result", () => {
    expect(classifyStandaloneHref("https://example.com/notes.pdf")).toBe("file");
    expect(classifyStandaloneHref("https://example.com/finance/q3")).toBe("job");
    expect(classifyStandaloneHref("https://example.com/hello")).toBe("link");
  });

  it("renders a lone link as a card and leaves an inline link as an anchor", () => {
    const alone = renderToStaticMarkup(<FormattedText text="[docs](https://example.com/a)" />);
    expect(alone).toContain('data-testid="message-embed"');
    expect(alone).toContain('data-kind="link"');
    expect(alone).toContain('rel="noopener noreferrer"');
    const mixed = renderToStaticMarkup(<FormattedText text="See [docs](https://example.com/a) today." />);
    expect(mixed).not.toContain('data-testid="message-embed"');
    expect(mixed).toContain('href="https://example.com/a"');
  });

  it("frames a host image and does not fetch a remote one", () => {
    const local = renderToStaticMarkup(<FormattedText text="![cat](/api/v1/media/abc/file)" />);
    expect(local).toContain('data-kind="image"');
    expect(local).toContain('src="/api/v1/media/abc/file"');
    const remote = renderToStaticMarkup(<FormattedText text="![cat](https://cdn.evil.example/beacon.gif)" />);
    expect(remote).not.toContain("<img");
    expect(remote).toContain('href="https://cdn.evil.example/beacon.gif"');
  });

  it("renders a markdown image as an image card, not a file card", () => {
    const image = renderToStaticMarkup(<FormattedText text="![lantern](https://cdn.example/lantern.png)" />);
    expect(image).toContain('data-testid="message-embed"');
    expect(image).toContain('data-kind="image"');
    expect(image).not.toContain('data-kind="file"');
    expect(image).not.toContain("<img");
    expect(image).toContain('href="https://cdn.example/lantern.png"');
    expect(image).toContain("lantern");
    const file = renderToStaticMarkup(<FormattedText text="[shot.png](https://cdn.example/shot.png)" />);
    expect(file).toContain('data-kind="file"');
  });
});

describe("file blocks and job results", () => {
  it("lifts a composer file block out of the plain text", () => {
    const segments = splitUserFileBlocks("Please read this.\n\n--- notes.txt ---\nhello\nthere");
    expect(segments).toEqual([
      { type: "text", text: "Please read this." },
      { type: "file", name: "notes.txt", body: "hello\nthere" },
    ]);
  });

  it("leaves ordinary prose as one text segment", () => {
    expect(splitUserFileBlocks("Just a note")).toEqual([{ type: "text", text: "Just a note" }]);
  });

  it("turns search hits into at most three result cards and ignores a bare number", () => {
    const hits = jobEmbedsFromOutput({
      success: true,
      data: {
        web: [
          { title: "One", url: "https://example.com/1", description: "First" },
          { title: "Two", url: "https://example.com/2", description: "Second" },
          { title: "Three", url: "https://example.com/3", description: "Third" },
          { title: "Four", url: "https://example.com/4", description: "Fourth" },
        ],
      },
    });
    expect(hits).toHaveLength(3);
    expect(hits[0]).toMatchObject({ title: "One", href: "https://example.com/1" });
    expect(jobEmbedsFromOutput({ result: 5 })).toEqual([]);
  });

  it("reads a titled job payload", () => {
    expect(jobEmbedsFromOutput({ title: "Brief", summary: "Cash lasts nine weeks." })).toEqual([
      { title: "Brief", detail: "Cash lasts nine weeks.", href: undefined },
    ]);
  });
});

describe("Nultron mascot", () => {
  it("exposes the state, its motion and the picture of the character, not a placeholder", () => {
    for (const state of ["idle", "thinking", "answering", "error"] as const) {
      const html = renderToStaticMarkup(<NultronMascot state={state} />);
      expect(html).toContain(`data-state="${state}"`);
      expect(html).toContain('data-testid="chat-mascot"');
      expect(html).toContain('data-mascot="nultron"');
      expect(html).not.toContain("data-placeholder");
      expect(html).toContain('class="chat-mascot nx-root"');
      expect(html).toContain("<img");
      expect(html).not.toContain("<svg");
    }
  });

  it("draws the head at chip size and the body from 64 px", () => {
    expect(renderToStaticMarkup(<NultronMascot state="idle" size={40} />)).toContain(`data-variant="head"`);
    expect(renderToStaticMarkup(<NultronMascot state="idle" size={40} />)).not.toContain(`data-variant="full"`);
    expect(renderToStaticMarkup(<NultronMascot state="idle" size={64} />)).toContain(`data-variant="full"`);
    expect(renderToStaticMarkup(<NultronMascot state="idle" placement="empty" />)).toContain(`data-variant="full"`);
    expect(renderToStaticMarkup(<NultronMascot state="idle" placement="beside" />)).toContain(`data-variant="head"`);
  });
});
