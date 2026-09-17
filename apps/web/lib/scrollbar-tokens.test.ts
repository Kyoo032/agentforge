import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"), "utf8");

function block(selector: string): string {
  const start = globalsCss.indexOf(`${selector} {`);
  expect(start, `${selector} block missing from globals.css`).toBeGreaterThan(-1);
  const end = globalsCss.indexOf("\n}", start);
  expect(end, `${selector} block is unterminated`).toBeGreaterThan(start);
  return globalsCss.slice(start, end);
}

const tokens = ["--scroll-thumb", "--scroll-thumb-hover", "--scroll-thumb-active"] as const;

describe("scrollbar styling", () => {
  it("defines every thumb token in both themes", () => {
    const light = block(":root");
    const dark = block(".dark");
    for (const token of tokens) {
      expect(light, `${token} missing from :root`).toContain(`${token}: color-mix(`);
      expect(dark, `${token} missing from .dark`).toContain(`${token}: color-mix(`);
    }
  });

  it("derives the thumb from --text so it follows the palette", () => {
    for (const token of tokens) {
      for (const match of globalsCss.matchAll(new RegExp(`${token}:\\s*([^;]+);`, "g"))) {
        expect(match[1], `${token} must mix var(--text)`).toContain("var(--text)");
      }
    }
  });

  it("paints the webkit thumb from the tokens and leaves the track transparent", () => {
    expect(globalsCss).toContain("::-webkit-scrollbar-thumb {");
    expect(globalsCss).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--scroll-thumb\)/);
    expect(globalsCss).toMatch(/::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--scroll-thumb-hover\)/);
    expect(globalsCss).toMatch(/::-webkit-scrollbar-thumb:active\s*\{[^}]*var\(--scroll-thumb-active\)/);
    expect(globalsCss).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/);
    expect(globalsCss).toMatch(/::-webkit-scrollbar-corner\s*\{[^}]*background:\s*transparent/);
  });

  it("keeps scrollbars visible for accessibility", () => {
    expect(globalsCss).not.toMatch(/::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
    expect(globalsCss).not.toMatch(/scrollbar-width:\s*none/);
    expect(globalsCss).toMatch(/::-webkit-scrollbar\s*\{\s*width:\s*10px;\s*height:\s*10px;\s*\}/);
  });

  it("fences the Firefox properties off from Chromium's pseudo-elements", () => {
    // Chromium ignores ::-webkit-scrollbar as soon as scrollbar-color is set on the element.
    const guard = globalsCss.indexOf("@supports not selector(::-webkit-scrollbar)");
    expect(guard, "scrollbar-color must sit behind an @supports guard").toBeGreaterThan(-1);
    const colorAt = globalsCss.indexOf("scrollbar-color:");
    expect(colorAt).toBeGreaterThan(guard);
    expect(globalsCss.slice(guard, colorAt)).not.toContain("\n}\n");
  });
});
