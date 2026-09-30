/**
 * A visually hidden file input is a tab stop unless something says otherwise.
 *
 * `sr-only` is 1 by 1 pixels, still focusable, and a file input has no text of its own. Tabbing from
 * the Chat message box landed on it: a control nobody can see, with no name, sitting between the box
 * and the toolbar (2026-09-29). It is right in one shape only: inside its own `<label>`, where the
 * label's text names it and the label is the control. Everywhere else a button opens the input, and
 * the input takes itself out of the tab order.
 *
 * `className="hidden"` (display: none) is not focusable and is not in scope.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const components = join(dirname(fileURLToPath(import.meta.url)), "..", "components");

/** Every `<input ... type="file" ...>` element in a source string, with where it starts. */
function fileInputs(source: string): Array<{ tag: string; at: number }> {
  const found: Array<{ tag: string; at: number }> = [];
  for (const match of source.matchAll(/<input\b[\s\S]*?\/>/g)) {
    if (/\btype="file"/.test(match[0])) {
      found.push({ tag: match[0], at: match.index ?? 0 });
    }
  }
  return found;
}

/** True when the nearest `<label` before `at` has not been closed by then. */
function insideLabel(source: string, at: number): boolean {
  const before = source.slice(0, at);
  return before.lastIndexOf("<label") > before.lastIndexOf("</label>");
}

describe("hidden file inputs", () => {
  const files = readdirSync(components)
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => ({ name, source: readFileSync(join(components, name), "utf8") }));

  it("finds the inputs it is meant to police", () => {
    const srOnly = files.flatMap(({ name, source }) =>
      fileInputs(source)
        .filter(({ tag }) => /className="sr-only"/.test(tag))
        .map(() => name),
    );
    expect(srOnly).toEqual(expect.arrayContaining(["chat-composer.tsx", "job-regen-panel.tsx"]));
  });

  it("takes every sr-only file input out of the tab order unless its own label names it", () => {
    const offenders: string[] = [];
    for (const { name, source } of files) {
      for (const { tag, at } of fileInputs(source)) {
        if (!/className="sr-only"/.test(tag)) continue;
        if (insideLabel(source, at)) continue;
        if (!/tabIndex=\{-1\}/.test(tag) || !/aria-hidden="true"/.test(tag)) {
          offenders.push(name);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
