import { describe, expect, it } from "vitest";
import {
  HOSTED_MARKER_ATTRIBUTE,
  HOSTED_MARKER_META,
  HOSTED_MARKER_TAG,
  injectHostedMarker,
  rootRelativeAssets,
  isHostedBuild,
  type HostedScope,
} from "./hosted-build";

/** The half of `document` this module reads, and nothing else. */
function scopeWith(meta: string | null, flag?: unknown): HostedScope {
  return {
    ...(flag === undefined ? {} : { __AGENTFORGE_SERVER__: flag }),
    document: {
      querySelector: (selector: string) =>
        selector === HOSTED_MARKER_META && meta !== null ? { getAttribute: () => meta } : null,
    },
  };
}

describe("isHostedBuild", () => {
  it("is false when there is no document and no flag at all", () => {
    expect(isHostedBuild({})).toBe(false);
    expect(isHostedBuild({ document: undefined })).toBe(false);
  });

  it("is false on a page the server did not mark", () => {
    expect(isHostedBuild(scopeWith(null))).toBe(false);
  });

  it("is true when the served page carries the marker meta tag", () => {
    expect(isHostedBuild(scopeWith("1"))).toBe(true);
  });

  it("reads the marker's content, so an empty or false one does not count", () => {
    for (const content of ["", "0", "false", "   "]) {
      expect(isHostedBuild(scopeWith(content))).toBe(false);
    }
    for (const content of ["1", "true", " TRUE "]) {
      expect(isHostedBuild(scopeWith(content))).toBe(true);
    }
  });

  it("also accepts the window flag, and ignores a non-true one", () => {
    expect(isHostedBuild(scopeWith(null, true))).toBe(true);
    expect(isHostedBuild(scopeWith(null, "1"))).toBe(true);
    expect(isHostedBuild(scopeWith(null, false))).toBe(false);
    expect(isHostedBuild(scopeWith(null, 0))).toBe(false);
    expect(isHostedBuild(scopeWith(null, "no"))).toBe(false);
  });

  it("survives a document whose querySelector throws", () => {
    expect(
      isHostedBuild({
        document: {
          querySelector: () => {
            throw new Error("detached");
          },
        },
      }),
    ).toBe(false);
  });

  it("defaults to the real globals, which are not a hosted page under vitest", () => {
    expect(isHostedBuild()).toBe(false);
  });
});

describe("injectHostedMarker", () => {
  const HTML = "<!doctype html>\n<html>\n  <head>\n    <title>DPSBuddy</title>\n  </head>\n  <body></body>\n</html>\n";

  it("returns the html untouched when this is not the hosted build", () => {
    expect(injectHostedMarker(HTML, false)).toBe(HTML);
  });

  it("inserts the marker before </head> on the hosted build", () => {
    const out = injectHostedMarker(HTML, true);
    expect(out).toContain(HOSTED_MARKER_TAG);
    expect(out.indexOf(HOSTED_MARKER_TAG)).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain("<title>DPSBuddy</title>");
  });

  it("produces a page `isHostedBuild` then reads as hosted", () => {
    const out = injectHostedMarker(HTML, true);
    const content = /content="([^"]*)"/.exec(HOSTED_MARKER_TAG)?.[1];
    expect(out).toContain(`name="${HOSTED_MARKER_ATTRIBUTE}"`);
    expect(isHostedBuild(scopeWith(content ?? ""))).toBe(true);
  });

  it("is idempotent: a page already marked is not marked twice", () => {
    const once = injectHostedMarker(HTML, true);
    const twice = injectHostedMarker(once, true);
    expect(twice).toBe(once);
    expect(twice.split(HOSTED_MARKER_TAG)).toHaveLength(2);
  });

  it("matches </head> whatever its case or spacing", () => {
    for (const html of ["<html><HEAD></HEAD><body></body></html>", "<html><head></head ><body></body></html>"]) {
      expect(injectHostedMarker(html, true)).toContain(HOSTED_MARKER_TAG);
    }
  });

  it("falls back to the front of a page with no head at all", () => {
    const out = injectHostedMarker("<div id=root></div>", true);
    expect(out.startsWith(HOSTED_MARKER_TAG)).toBe(true);
    expect(out).toContain("<div id=root></div>");
  });

  it("never rewrites anything but the head", () => {
    const out = injectHostedMarker(HTML, true);
    expect(out.replace(HOSTED_MARKER_TAG, "")).toBe(HTML);
  });
});

describe("rootRelativeAssets", () => {
  /**
   * The real built shell. `apps/web/vite.config.ts` sets `base: "./"`, which the packaged desktop
   * needs — it loads the bundle off disk, where there is no origin to be absolute against.
   */
  const BUILT =
    '<!doctype html>\n<html lang="en">\n  <head>\n' +
    '    <link rel="icon" type="image/png" href="./brand/logo.png" />\n' +
    '    <script type="module" crossorigin src="./assets/index-abc.js"></script>\n' +
    '    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">\n' +
    "  </head>\n  <body></body>\n</html>\n";

  /**
   * The bug this exists for. The hosted server answers every GET that is not `/api/` with this one
   * shell, so `/auth/callback` — where the portal drops a person after they sign in, by top-level
   * navigation — gets a document whose own URL makes `./assets/index-abc.js` mean
   * `/auth/assets/index-abc.js`. That path is not a file, so the SPA fallback answers it with the
   * shell again, as `text/html`, and the browser refuses the module. Nothing renders, the callback
   * never posts its code, and sign-in cannot complete on the hosted deployment at all.
   */
  it("makes the built shell's asset URLs absolute, so a nested route loads them", () => {
    const out = rootRelativeAssets(BUILT);
    expect(out).toContain('src="/assets/index-abc.js"');
    expect(out).toContain('href="/assets/index-abc.css"');
    expect(out).toContain('href="/brand/logo.png"');
    expect(out).not.toContain('"./');
  });

  it("leaves an already absolute shell alone", () => {
    const absolute = BUILT.replace(/"\.\//g, '"/');
    expect(rootRelativeAssets(absolute)).toBe(absolute);
  });

  it("is idempotent", () => {
    const once = rootRelativeAssets(BUILT);
    expect(rootRelativeAssets(once)).toBe(once);
  });

  it("touches only src and href, never text or a data URI", () => {
    const html = '<p>see ./assets/readme.md</p><img src="data:image/png;base64,AAA" />';
    expect(rootRelativeAssets(html)).toBe(html);
  });

  it("does not turn a protocol-relative or external URL into a path", () => {
    const html = '<script src="https://cdn.example.test/x.js"></script><link href="//cdn/x.css">';
    expect(rootRelativeAssets(html)).toBe(html);
  });
});
