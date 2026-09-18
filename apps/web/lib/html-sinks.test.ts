/**
 * The renderer has no HTML sink, and this is what keeps it that way.
 *
 * `xss-render.test.tsx` proves the markdown path renders a payload inert. That proof is only worth
 * something while the app has no other way to put a string into the document: one
 * `dangerouslySetInnerHTML` for a "rich preview", one `innerHTML` in a chart helper, one
 * `<iframe srcdoc>` for a model-written page, and the audit is void. So this suite reads every
 * source file the renderer ships and refuses the sinks outright.
 *
 * `apps/web` runs vitest without a DOM, which is why this is a source scan rather than a render —
 * the same shape the other wiring suites in this folder use.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const SCANNED_DIRECTORIES = ["components", "lib", "src"] as const;

type SourceFile = { readonly path: string; readonly text: string };

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const sources: SourceFile[] = SCANNED_DIRECTORIES.flatMap((dir) =>
  walk(join(webRoot, dir)).map((path) => ({ path: relative(webRoot, path), text: readFileSync(path, "utf8") })),
);

/** Files whose text matches, as `path:line` so a failure names the offender. */
function hits(pattern: RegExp): string[] {
  return sources.flatMap((file) =>
    file.text
      .split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      .filter((row) => new RegExp(pattern.source, pattern.flags.replace("g", "")).test(row.line))
      .map((row) => `${file.path}:${row.number} ${row.line.trim()}`),
  );
}

describe("the renderer's HTML sinks", () => {
  it("scans the files it thinks it is scanning", () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((file) => file.path.includes("formatted-text"))).toBe(true);
  });

  it("never writes a string into the document as markup", () => {
    expect(hits(/dangerouslySetInnerHTML/)).toEqual([]);
    expect(hits(/\.innerHTML\b/)).toEqual([]);
    expect(hits(/\.outerHTML\b/)).toEqual([]);
    expect(hits(/insertAdjacentHTML/)).toEqual([]);
    expect(hits(/document\s*\.\s*write\b/)).toEqual([]);
  });

  it("never evaluates a string as code", () => {
    expect(hits(/\beval\s*\(/)).toEqual([]);
    expect(hits(/new\s+Function\s*\(/)).toEqual([]);
  });

  /**
   * Model-written HTML has exactly one safe home: an iframe that is sandboxed and NOT
   * `allow-same-origin`, because same-origin plus scripts gives the frame the app's cookies and its
   * DOM. There is no iframe in the app today; if one arrives, it arrives with a sandbox.
   */
  it("has no iframe, and any future one is sandboxed without allow-same-origin", () => {
    const frames = hits(/<iframe/i);
    for (const frame of frames) {
      expect(frame).toMatch(/sandbox/);
      expect(frame).not.toMatch(/allow-same-origin/);
    }
    expect(hits(/srcdoc/i)).toEqual([]);
    expect(hits(/allow-same-origin/)).toEqual([]);
  });
});

describe("links the renderer opens in a new tab", () => {
  it("always severs the opener and the referrer", () => {
    const blanks = hits(/target="_blank"/);
    expect(blanks.length).toBeGreaterThan(0);
    const withoutRel = sources.flatMap((file) => {
      // `rel` sits on the line above or below `target` in a formatted JSX element, so the check is
      // per element: split on the tag opener and look at each piece that opens a new tab.
      const elements = file.text.split(/<a[\s>]/).slice(1);
      return elements
        .map((element) => element.slice(0, element.indexOf(">")))
        .filter((element) => element.includes('target="_blank"'))
        .filter((element) => !element.includes('rel="noopener noreferrer"'))
        .map((element) => `${file.path}: ${element.replace(/\s+/g, " ").trim()}`);
    });
    expect(withoutRel).toEqual([]);
  });

  /** Every anchor whose href comes from a model or a fetched source is checked first. */
  it("checks a model-supplied href against the scheme allowlist", () => {
    for (const path of [
      "components/formatted-text.tsx",
      "components/research-preview.tsx",
      "components/market-briefing-view.tsx",
      "components/market-ticker-card.tsx",
    ]) {
      const file = sources.find((candidate) => candidate.path.replace(/\\/g, "/") === path);
      expect(file, path).toBeDefined();
      expect(file?.text).toContain("safeLinkHref");
    }
  });
});

describe("what the renderer keeps in Web Storage", () => {
  /**
   * Nothing secret, ever: `localStorage` survives a sign-out, is readable by any script that reaches
   * the page, and is shared by every tab. The session lives in an HttpOnly cookie precisely so it is
   * not here (web-security-spec T1). What is allowed is view state — theme, rail width, drafts.
   */
  it("stores view preferences and drafts only", () => {
    // The file path is dropped first: `chat-session.tsx` is not a secret, its storage keys are what
    // this looks at.
    const storageLines = hits(/(localStorage|sessionStorage)/).map((hit) => hit.replace(/^\S+ /, ""));
    expect(storageLines.length).toBeGreaterThan(0);
    const suspicious = storageLines.filter((line) =>
      /token|secret|password|passphrase|api[-_]?key|credential|bearer|session|auth|csrf/i.test(line),
    );
    expect(suspicious).toEqual([]);
  });
});
