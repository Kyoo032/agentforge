/**
 * Rows that have to give way on a narrow screen, held by the shape of their markup.
 *
 * Node has no layout engine, so this cannot measure a width; what it holds is the wrap rule the
 * width depends on. The widths themselves are driven live at 375 and 1280:
 * `.cursor/skills/verify-agentforge/features/settings.md`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(web, ...parts), "utf8").replace(/\r\n/g, "\n");

describe("the workspace row", () => {
  const source = read("components", "workspaces-page.tsx");

  it("wraps its actions under the name instead of squeezing the name beside them", () => {
    // Measured on 2026-09-29 at 375 px: three actions at 160 px left the name 90 px, and
    // "edit-idor-cd22b72e" broke into three hyphenated lines.
    const row = /<div className="([^"]*)">\s*<div className="([^"]*)">\s*<p className="font-medium/.exec(source);
    expect(row, "the workspace row markup changed; update this test with it").not.toBeNull();
    const [, rowClass = "", nameClass = ""] = row ?? [];
    expect(rowClass).toContain("flex-wrap");
    expect(nameClass).toContain("min-w-0");
    expect(nameClass).toContain("flex-1");
    expect(source).toMatch(/className="ml-auto flex shrink-0 gap-2"/);
  });
});

describe("a reply with a token that has no space in it", () => {
  const css = read("app", "globals.css");

  it("lets prose break anywhere as a last resort, and leaves table cells alone", () => {
    // Measured on 2026-09-29 at 320 px: a 100-character link put its right edge at 1251 px in a 154 px
    // column. Cells stay out of it: `anywhere` would shrink their minimum width and a scrolling table
    // would squeeze instead.
    const rule = /\.formatted-md :is\(([^)]*)\)\s*\{([^}]*)\}/.exec(css);
    expect(rule, "the prose wrap rule is missing from globals.css").not.toBeNull();
    const [, selectors = "", body = ""] = rule ?? [];
    expect(selectors.split(",").map((s) => s.trim())).toEqual(
      expect.arrayContaining(["p", "li", "blockquote", "h1", "h2", "h3"]),
    );
    expect(selectors).not.toMatch(/\btd\b|\bth\b/);
    expect(body).toContain("overflow-wrap: anywhere");
  });
});

describe("a message bubble with a token that has no space in it", () => {
  it("breaks it anywhere: every plain text paragraph in the turn view says so", () => {
    // Measured on 2026-09-29 at 320 px: a pasted 120-character link scrolled 1201 px inside a
    // 136 px bubble, because `whitespace-pre-wrap` alone breaks lines only where there is space.
    const source = read("components", "chat-turn.tsx");
    const paragraphs = [...source.matchAll(/<p\b[^>]*className="([^"]*whitespace-pre-wrap[^"]*)"/g)].map((m) => m[1]);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    for (const className of paragraphs) {
      expect(className).toContain("[overflow-wrap:anywhere]");
    }
  });
});

/** Every `.tsx` under `components/`, by path relative to it. */
function componentFiles(dir = join(web, "components"), prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? componentFiles(join(dir, entry.name), `${prefix}${entry.name}/`)
      : entry.name.endsWith(".tsx")
        ? [`${prefix}${entry.name}`]
        : [],
  );
}

describe("any text block that keeps its line breaks", () => {
  it("also breaks a token with no space in it: `whitespace-pre-wrap` alone breaks only at spaces", () => {
    // Measured on 2026-09-29 at 320 px for the chat bubbles and `.formatted-md`, then found again in
    // the Channels feed (a Telegram link), the Market briefing note, the Education book text, the
    // Meeting transcript, the message embeds and the Finance ratios notes. A long link or a pasted id
    // scrolls the whole pane sideways. The class is checked on the string that holds it, wherever the
    // element is, so a new block cannot be added without it.
    const offenders: string[] = [];
    for (const file of componentFiles()) {
      const source = read("components", file);
      for (const match of source.matchAll(/whitespace-pre-wrap/g)) {
        const at = match.index ?? 0;
        const quote = /["'`]/;
        let start = at;
        while (start > 0 && !quote.test(source[start - 1] ?? "")) start -= 1;
        let end = at;
        while (end < source.length && !quote.test(source[end] ?? "")) end += 1;
        const className = source.slice(start, end);
        if (!/\[overflow-wrap:anywhere\]|\bbreak-words\b|\bbreak-all\b/.test(className)) {
          offenders.push(`${file}:${source.slice(0, at).split("\n").length}`);
        }
      }
    }
    expect(offenders, "whitespace-pre-wrap with no overflow-wrap").toEqual([]);
  });

  it("holds the sites that were fixed, by name", () => {
    for (const [file, hits] of [
      ["channels-page.tsx", 1],
      ["market-briefing-view.tsx", 1],
      ["education-studio.tsx", 1],
      ["meeting-studio.tsx", 1],
      ["message-embed.tsx", 3],
      ["finance-steps/ratios/ratios-result.tsx", 1],
    ] as const) {
      const source = read("components", file);
      expect(source.match(/\[overflow-wrap:anywhere\]/g)?.length ?? 0, file).toBeGreaterThanOrEqual(hits);
    }
  });
});

describe("the composer's attachment chip", () => {
  const source = read("components", "chat-composer.tsx");

  it("gives up characters of a long name before it gives up the remove button", () => {
    // Measured on 2026-09-29 at 320 px: a 66-character name made the chip 235 px in a 186 px row,
    // 36 px past the composer, with the × at 314-323 px in a 320 px window.
    const chip = /<li\s+key=\{item\.id\}\s+className="([^"]*)"\s+data-testid="composer-attachment"/.exec(source);
    expect(chip, "the attachment chip markup changed; update this test with it").not.toBeNull();
    expect(chip?.[1]).toContain("max-w-full");
    expect(source).toMatch(/<span className="min-w-0 max-w-\[12rem\] truncate">\{item\.file\.name\}<\/span>/);
    expect(source).toMatch(/className="shrink-0 text-\[var\(--text-3\)\] hover:text-\[var\(--text\)\]"\s+aria-label=\{t\("chat\.removeAttachment"/);
  });
});
