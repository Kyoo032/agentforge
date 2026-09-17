import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, "..", "components");
const globalsCss = readFileSync(join(here, "..", "app", "globals.css"), "utf8");

const files = readdirSync(componentsDir)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, src: readFileSync(join(componentsDir, name), "utf8") }));

/** Tags that render a native <select>: the element itself and the shared wrapper. */
const SELECT_TAGS = ["<select", "<ModelSelect"] as const;

/**
 * Return the opening tag starting at `start`, skipping over `>` that sit inside
 * a JSX expression (`{() => x}`) or inside a string literal.
 */
function openingTag(src: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote && src[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

type Tag = { file: string; tag: string; className: string };

function selectTags(): Tag[] {
  const found: Tag[] = [];
  for (const { name, src } of files) {
    for (const marker of SELECT_TAGS) {
      let at = src.indexOf(marker);
      while (at !== -1) {
        const next = src[at + marker.length];
        // `<select` must not match `<selectFoo`; the tag ends at whitespace, `>` or `/`.
        if (next === undefined || /[\s>/]/.test(next)) {
          const tag = openingTag(src, at);
          for (const match of tag.matchAll(/className=\{?"([^"]*)"/g)) {
            found.push({ file: name, tag: marker, className: match[1] });
          }
        }
        at = src.indexOf(marker, at + marker.length);
      }
    }
  }
  return found;
}

const tags = selectTags();

function hasClass(className: string, token: string): boolean {
  return className.split(/\s+/).includes(token);
}

describe("select-field", () => {
  it("finds the select call sites it is meant to guard", () => {
    expect(tags.length).toBeGreaterThan(10);
    expect(tags.some((tag) => tag.file === "videos-studio.tsx")).toBe(true);
  });

  it("never combines a fixed h-8 height with py-2 on a select", () => {
    // 32px tall minus 1px borders minus 8px+8px padding leaves a 14px content box.
    // A 14px Inter line box is ~17px and Chromium clips a <select> instead of
    // letting it overflow, so the baseline and descenders get cut off.
    const clipped = tags.filter((tag) => hasClass(tag.className, "h-8") && hasClass(tag.className, "py-2"));
    expect(
      clipped.map((tag) => `${tag.file} ${tag.tag} "${tag.className}"`),
      "use .select-field instead of an ad-hoc h-8/py-2 recipe",
    ).toEqual([]);
  });

  it("never pairs a fixed height with vertical padding on a select", () => {
    const heights = ["h-8", "h-9", "h-10"];
    const pads = ["py-1", "py-1.5", "py-2", "py-2.5", "py-3"];
    const risky = tags.filter(
      (tag) => heights.some((h) => hasClass(tag.className, h)) && pads.some((p) => hasClass(tag.className, p)),
    );
    expect(risky.map((tag) => `${tag.file} "${tag.className}"`)).toEqual([]);
  });

  it("defines .select-field with a full-height line box and no vertical padding", () => {
    const block = globalsCss.slice(globalsCss.indexOf(".select-field {"));
    expect(globalsCss).toContain(".select-field {");
    const body = block.slice(0, block.indexOf("\n  }"));
    expect(body).toContain("h-8");
    expect(body).toContain("py-0");
    expect(body).toContain("leading-8");
    expect(body).toContain("appearance: auto");
  });

  it("defines .text-field with the same geometry for the inputs that share the recipe", () => {
    const block = globalsCss.slice(globalsCss.indexOf(".text-field {"));
    expect(globalsCss).toContain(".text-field {");
    const body = block.slice(0, block.indexOf("\n  }"));
    expect(body).toContain("h-8");
    expect(body).toContain("py-0");
    expect(body).toContain("leading-8");
  });

  it("keeps both helpers inside @layer components so utilities still win", () => {
    const layer = globalsCss.indexOf("@layer components {");
    expect(layer).toBeGreaterThan(-1);
    expect(globalsCss.indexOf(".select-field {")).toBeGreaterThan(layer);
    expect(globalsCss.indexOf(".text-field {")).toBeGreaterThan(layer);
  });

  it("routes the studios that clipped through .select-field", () => {
    for (const file of ["videos-studio.tsx", "images-studio.tsx", "presentations-studio.tsx"]) {
      const src = files.find((entry) => entry.name === file)?.src ?? "";
      expect(src, `${file} should use .select-field`).toContain("select-field");
    }
  });
});
