import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contract for the motion layer in `app/globals.css` (ported from the 2026-09-22 dark-desk pass
 * onto the 0.15.0 warm desk).
 *
 * Three things have to hold, and none of them shows in a screenshot:
 *  1. One scale. Durations and easings come from tokens, so the desk moves at one tempo. That
 *     covers the Tailwind utilities in components too, not only the hand-written CSS.
 *  2. `prefers-reduced-motion: reduce` is honoured in ONE block and nothing escapes it.
 *  3. Keyframes animate only `transform` and `opacity`, so the compositor does the work.
 */

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Normalise line endings: the checkout may carry CRLF.
const globalsCss = readFileSync(join(webRoot, "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");

const REDUCED_QUERY = "@media (prefers-reduced-motion: reduce)";

/** Comments carry selector-looking text, so strip them before matching rules. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The text of a block, brace-matched from the `{` after `marker`. */
function blockAfter(css: string, marker: string): string {
  const at = css.indexOf(marker);
  expect(at, `${marker} missing from globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`${marker} block is unterminated`);
}

const css = stripComments(globalsCss);
const reducedBlock = blockAfter(css, REDUCED_QUERY);
const outsideReduced = css.replace(reducedBlock, "");

/** A duration literal (`150ms`, `0.2s`) anywhere in a value, once `var(...)` reads are removed. */
const LITERAL_DURATION = /(^|[\s,(])\d*\.?\d+m?s\b/;
/** A named or hand-written curve, once `var(...)` reads are removed. */
const LITERAL_EASING = /\b(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b|cubic-bezier\(|steps\(/;
const withoutVars = (value: string) => value.replace(/var\(\s*--[\w-]+\s*\)/g, "");

/** Every `selector { body }` pair with no nested braces, outside the reduced block. */
function flatRules(source: string): { selectors: string[]; body: string }[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.startsWith("@")),
    body: m[2],
  }));
}

// --- Renderer sources, for the Tailwind side of the scale ------------------

const SOURCE_DIRS = ["components", "src", "lib"] as const;

function rendererSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const dir of SOURCE_DIRS) {
    for (const entry of readdirSync(join(webRoot, dir), { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
      const raw = readFileSync(join(webRoot, dir, entry), "utf8");
      // Comments say "transition" in prose (state machines); only code can carry a class name.
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      out.push({ file: `${dir}/${entry.replace(/\\/g, "/")}`, text });
    }
  }
  return out;
}

const sources = rendererSources();

describe("motion scale", () => {
  it("defines four durations and two easings as tokens", () => {
    const root = blockAfter(css, ":root");
    for (const token of [
      "--motion-1: 120ms",
      "--motion-2: 180ms",
      "--motion-3: 240ms",
      "--motion-4: 320ms",
      "--ease-out: cubic-bezier(",
      "--ease-entrance: cubic-bezier(",
    ]) {
      expect(root, `${token} missing from :root`).toContain(token);
    }
  });

  it("builds the compound aliases from the scale instead of raw values", () => {
    for (const alias of ["--motion-hover", "--motion-select", "--motion-focus", "--motion-fade"]) {
      const match = new RegExp(`${alias}:\\s*([^;]+);`).exec(css);
      expect(match, `${alias} missing`).not.toBeNull();
      expect(match?.[1], `${alias} must read the scale`).toMatch(/var\(--motion-\d\)/);
      expect(match?.[1], `${alias} must read an easing token`).toMatch(/var\(--ease-(out|entrance)\)/);
    }
  });

  it("writes no ad-hoc duration or easing in any transition or animation declaration", () => {
    const offenders: string[] = [];
    const declaration =
      /\b(transition|transition-duration|transition-delay|transition-timing-function|animation|animation-duration|animation-delay|animation-timing-function)\s*:\s*([^;]+);/g;
    for (const match of outsideReduced.matchAll(declaration)) {
      const value = withoutVars(match[2]);
      if (LITERAL_DURATION.test(value)) offenders.push(`literal duration: ${match[1]}: ${match[2].trim()}`);
      if (LITERAL_EASING.test(value)) offenders.push(`literal easing: ${match[1]}: ${match[2].trim()}`);
    }
    expect(offenders, `motion values must come from the scale:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("animates only transform and opacity inside its keyframes", () => {
    const banned = /\b(width|height|top|left|right|bottom|margin|padding|box-shadow|filter|background-position)\s*:/;
    const offenders: string[] = [];
    for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      for (const line of blockAfter(css, `@keyframes ${match[1]}`).split("\n")) {
        if (banned.test(line)) offenders.push(`${match[1]}: ${line.trim()}`);
      }
    }
    expect(offenders, `keyframes must stay on the compositor:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

describe("Tailwind motion utilities in the renderer", () => {
  it("reads the sources it claims to scan", () => {
    // A silent empty scan would make the two assertions below vacuous.
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some(({ file }) => file === "components/chat-composer.tsx")).toBe(true);
  });

  it("uses no literal duration, easing, delay or animation utility", () => {
    const literal =
      /(?<![\w-])(duration-(\d+|\[[^\]]+\])|ease-(in|out|in-out|linear|\[[^\]]+\])|delay-(\d+|\[[^\]]+\])|animate-[\w[\]-]+|\[transition[^\]]*\])(?![\w-])/g;
    const inlineStyle = /\btransition\s*:\s*["'`][^"'`]*\d+m?s/g;
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      for (const match of text.matchAll(literal)) offenders.push(`${file}: ${match[0]}`);
      for (const match of text.matchAll(inlineStyle)) offenders.push(`${file}: ${match[0]}`);
    }
    expect(offenders, `motion literals in components:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("puts every transition utility a component uses back on the scale", () => {
    const retimed = flatRules(outsideReduced).find(
      ({ body }) =>
        /transition-duration:\s*var\(--motion-\d\)/.test(body) &&
        /transition-timing-function:\s*var\(--ease-(out|entrance)\)/.test(body),
    );
    expect(retimed, "the Tailwind retime rule is missing from globals.css").toBeDefined();
    const used = new Set<string>();
    for (const { text } of sources) {
      for (const match of text.matchAll(
        /(?<![\w-])(?:[\w-]+:)*(transition(?:-(?:all|colors|opacity|shadow|transform))?)(?![\w-])/g,
      )) {
        used.add(`.${match[1]}`);
      }
    }
    expect(used.size, "no transition utility found; the scan or the renderer moved").toBeGreaterThan(0);
    const missing = [...used].filter((selector) => !retimed?.selectors.includes(selector));
    expect(missing, `transition utilities left on Tailwind's 150ms:\n  ${missing.join("\n  ")}`).toEqual([]);
  });
});

describe("prefers-reduced-motion", () => {
  it("has exactly one reduce block", () => {
    const hits = [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion/g)];
    expect(hits, "reduced-motion handling must live in one place").toHaveLength(1);
  });

  it("stops every animation and every transition universally, pseudo-elements included", () => {
    expect(reducedBlock, "the reset must cover ::before/::after too").toMatch(
      /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{/,
    );
    expect(reducedBlock).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(reducedBlock).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(reducedBlock).toMatch(/animation-delay:\s*0ms\s*!important/);
    expect(reducedBlock).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(reducedBlock).toMatch(/transition-delay:\s*0ms\s*!important/);
    expect(reducedBlock).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it("names every looping animation so none is left frozen mid-cycle", () => {
    // An infinite animation has no meaningful still frame; `animation-iteration-count: 1` would
    // park it on its first keyframe, so each one must be switched off by name. The warm desk
    // ships none today; this holds the line for the first one that lands.
    const escaped = flatRules(outsideReduced)
      .filter(({ body }) => /animation[\w-]*\s*:[^;]*\binfinite\b/.test(body))
      .flatMap(({ selectors }) => selectors)
      .filter((selector) => !reducedBlock.includes(selector.replace(/::(before|after)$/, "")));
    expect(escaped, `loops not handled under reduced motion:\n  ${escaped.join("\n  ")}`).toEqual([]);
  });

  it("leaves no element parked in a transformed pose", () => {
    // A rule whose rest state is a transform (an indicator, a pressed button) must be reset
    // inside the block, or reduced-motion users see it mid-move. None exist on the warm desk.
    const escaped = flatRules(outsideReduced)
      .filter(({ body }) => /(^|[\s;])transform\s*:\s*(?!none)/.test(body))
      .flatMap(({ selectors }) => selectors)
      .filter((selector) => !reducedBlock.includes(selector));
    expect(escaped, `transforms not reset under reduced motion:\n  ${escaped.join("\n  ")}`).toEqual([]);
  });

  it("the rule scanner finds real rules (guards the two checks above)", () => {
    const rules = flatRules("a, b::after { animation: x var(--motion-1) infinite; }\n.c { transform: scale(0); }");
    expect(rules.map((r) => r.selectors)).toEqual([["a", "b::after"], [".c"]]);
  });
});
