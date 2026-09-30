import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isMascotBusy, MASCOT_STATES } from "./mascot-states";

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

/** Drop `@keyframes` blocks so a stop like `50% { transform }` is not read as a rest rule. */
function withoutAtKeyframes(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const at = source.indexOf("@keyframes", i);
    if (at < 0) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, at);
    const open = source.indexOf("{", at);
    let depth = 0;
    let j = open;
    for (; j < source.length; j += 1) {
      if (source[j] === "{") depth += 1;
      else if (source[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          j += 1;
          break;
        }
      }
    }
    i = j;
  }
  return out;
}

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
    // inside the block, or reduced-motion users see it mid-move. Keyframe stops are not a
    // rest state; the keyframe test above already limits them to transform and opacity.
    const escaped = flatRules(withoutAtKeyframes(outsideReduced))
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

/** Every `selector { body }` whose selector is an ambient-pause one, with the `:is()` list left whole. */
const AMBIENT = 'html[data-ambient="paused"]';
const ambientRules = [...outsideReduced.matchAll(/(html\[data-ambient="paused"\][^{}]*)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].replace(/\s+/g, " ").trim(),
  body: m[2],
}));

/** The class a rule is about: `.chat-mascot[data-state="wave"] .nx-forearm-l` is about `chat-mascot`. */
const rootClass = (selector: string) => /\.([\w-]+)/.exec(selector)?.[1] ?? null;

// The Nultron mascot keeps its own motion beside its component (`components/nultron/nultron.css`), and
// its loops answer to the same ambient pause below. `lib/nultron-motion.test.ts` holds the rest of its contract.
const nultronCss = stripComments(
  readFileSync(join(webRoot, "components", "nultron", "nultron.css"), "utf8").replace(/\r\n/g, "\n"),
);

const infiniteRules = flatRules(`${outsideReduced}\n${nultronCss}`).filter(({ body }) =>
  /animation[\w-]*\s*:[^;]*\binfinite\b/.test(body),
);

/** The members of every `:is(...)` list in a selector: `:is(a, b:not([x]) *)` gives `a` and `b:not([x]) *`. */
function isMembers(selector: string): string[] {
  const members: string[] = [];
  for (const open of selector.matchAll(/:is\(/g)) {
    let depth = 1;
    let from = (open.index ?? 0) + open[0].length;
    let at = from;
    for (; at < selector.length; at += 1) {
      const char = selector[at];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      } else if (char === "," && depth === 1) {
        members.push(selector.slice(from, at).trim());
        from = at + 1;
      }
    }
    members.push(selector.slice(from, at).trim());
  }
  return members;
}

const listedLoops = new Set(ambientRules.flatMap(({ selector }) => isMembers(selector)));

describe("ambient pause", () => {
  it("finds the rules it audits (guards the checks below)", () => {
    // Two rules: the mascot that is not at a job (every state but active) and status when hidden.
    expect(ambientRules.length).toBeGreaterThanOrEqual(2);
    expect(infiniteRules.length).toBeGreaterThan(3);
    expect(isMembers("a :is(b, c:not([x]) *, d > e)")).toEqual(["b", "c:not([x]) *", "d > e"]);
    expect(listedLoops.has(".pulse-dots > span")).toBe(true);
  });

  it("pauses through `animation-play-state: ... paused !important`, so no specificity tie can restart a loop", () => {
    for (const { selector, body } of ambientRules) {
      const pauses = /animation-play-state:\s*(running,\s*)?paused\s*!important/.test(body);
      // The one other thing a rule here may do: send a loop that would freeze on a bad frame back to rest.
      const rests = /animation-name:\s*none\s*!important/.test(body);
      expect(pauses || rests, selector).toBe(true);
    }
  });

  it("lists every infinite loop, exactly, so a new one cannot run through an idle desk", () => {
    const mascotCovered =
      listedLoops.has(".chat-mascot:not([data-busy]) *") && listedLoops.has(".chat-mascot[data-busy] *");
    const escaped = infiniteRules
      .flatMap(({ selectors }) => selectors)
      .filter((selector) => (selector.startsWith(".chat-mascot") ? !mascotCovered : !listedLoops.has(selector)));
    expect(escaped, `loops that no ${AMBIENT} rule pauses:\n  ${escaped.join("\n  ")}`).toEqual([]);
  });

  it("never lists an entrance: pausing a finite animation leaves its element invisible", () => {
    for (const { selector } of ambientRules) {
      expect(selector, selector).not.toMatch(/\.(enter-|page-enter|tile-bounce|confetti)/);
    }
  });

  it("keeps a status indicator moving through `idle` and `blurred`, and stops it only when hidden", () => {
    const status = ambientRules.find(({ selector }) => isMembers(selector).includes(".pulse-dots > span"));
    expect(status?.selector.startsWith(`${AMBIENT}[data-ambient-reason="hidden"]`)).toBe(true);
    expect(isMembers(status?.selector ?? "")).toEqual([
      ".pulse-dots > span",
      ".chat-mascot[data-busy]",
      ".chat-mascot[data-busy] *",
    ]);
  });

  it("does not let the everything-but-active rule reach a mascot at a job", () => {
    // The rule that pauses in `idle` and `blurred` as well as `hidden`. It names no decoration any
    // more (decoration does not loop); what it still holds is a mascot that is not at a job.
    const notActive = ambientRules.find(({ selector }) => !selector.includes("data-ambient-reason"));
    const members = isMembers(notActive?.selector ?? "");
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(member, "a bare .chat-mascot here would void the busy exemption").toContain(":not([data-busy])");
    }
    expect(notActive?.selector).not.toContain(".pulse-dots");
  });

  it("needs no resting-style rule for the mascot: it has no decoration loop, and every clip starts on its rest pose", () => {
    // The placeholder mascot blinked and floated Zs in infinite loops that froze on a bad frame when
    // paused, so a rule sent them back to rest. The Nultron mascot blinks from a timer and plays finite
    // clips (`lib/nultron-motion.test.ts`), and none of the old class names may come back.
    expect(css).not.toMatch(/chat-mascot-(eyes|prop|face|arm|look|body|mouth|shut)/);
    expect(ambientRules.some(({ body }) => /animation-name:\s*none\s*!important/.test(body))).toBe(false);
  });

  it("leaves the desk's dot grid standing still", () => {
    const grid = flatRules(outsideReduced).filter(({ selectors }) => selectors.includes(".desk-canvas::before"));
    expect(grid.length, ".desk-canvas::before rule missing").toBeGreaterThan(0);
    for (const { body } of grid) {
      expect(body).not.toMatch(/animation/);
    }
    expect(css).not.toContain("nx-dots");
  });
});

// --- No decoration loops ---------------------------------------------------------------------------
//
// The packaged Windows app runs Chromium without the GPU (`app.disableHardwareAcceleration()`), so a
// running CSS animation is composited in software on the CPU, a whole frame at a time. Measured in a
// throwaway Electron that mirrors that shell: the empty /chat with its shapes bobbing and spinning held
// 9 to 11% of the machine for as long as somebody used it, and 0.1% once nothing looped. Pausing after
// 12 quiet seconds (`lib/ambient-motion.ts`) cannot help a desk that is in use, so the rule is one
// level up: decoration does not loop. It plays once when it arrives, it moves while the pointer moves,
// it reacts once to a hover or a tap. Only status may loop, and only stepped.

/** Every stylesheet the renderer ships, comments stripped, by path under `apps/web`. */
function stylesheets(): { file: string; css: string }[] {
  const out: { file: string; css: string }[] = [];
  for (const dir of ["app", "components", "src", "lib"]) {
    for (const entry of readdirSync(join(webRoot, dir), { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith(".css")) continue;
      const raw = readFileSync(join(webRoot, dir, entry), "utf8").replace(/\r\n/g, "\n");
      out.push({ file: `${dir}/${entry.replace(/\\/g, "/")}`, css: stripComments(raw) });
    }
  }
  return out;
}

/**
 * The mascot's own stylesheet answers to the mascot's own contract (`lib/nultron-motion.test.ts`: a
 * loop only under `[data-busy]`, stepped). It is the one file this rule does not read.
 */
const MASCOT_STYLESHEET = "components/nultron/nultron.css";

/**
 * What may loop. A loop is allowed only when it means "work is running", and it must step:
 *  - the working dots, `.pulse-dots > span`;
 *  - anything under `[data-busy]`, an attribute only `isMascotBusy` sets.
 * Adding to this list is a product decision (a status indicator), never a styling one.
 */
const BUSY_LOOP_SELECTORS = new Set([".pulse-dots > span"]);
const isBusyLoop = (selector: string) => BUSY_LOOP_SELECTORS.has(selector) || selector.includes("[data-busy]");

/** Every `infinite` animation declaration outside the mascot's stylesheet, with the rule it sits in. */
function loopsOutsideTheMascot(sheets: { file: string; css: string }[]) {
  return sheets
    .filter(({ file }) => file !== MASCOT_STYLESHEET)
    .flatMap(({ file, css: source }) =>
      flatRules(withoutAtKeyframes(source))
        .filter(({ body }) => /animation[\w-]*\s*:[^;]*\binfinite\b/.test(body))
        .flatMap(({ selectors, body }) => selectors.map((selector) => ({ file, selector, body }))),
    );
}

describe("decoration does not loop", () => {
  const sheets = stylesheets();

  it("reads the stylesheets it claims to scan (guards the checks below)", () => {
    const files = sheets.map(({ file }) => file);
    expect(files).toContain("app/globals.css");
    expect(files).toContain(MASCOT_STYLESHEET);
    expect(loopsOutsideTheMascot(sheets).length, "the working dots are a loop: the scan found none").toBeGreaterThan(0);
    // The detector itself, on the three spellings that matter.
    const spelled = (source: string) => loopsOutsideTheMascot([{ file: "x.css", css: source }]).length;
    expect(spelled(".a { animation: nx-bob 4s var(--ease-wave) infinite; }")).toBe(1);
    expect(spelled(".a { animation-iteration-count: infinite; }")).toBe(1);
    expect(spelled(".a, .b { animation: x 1s infinite; }\n@media (x) { .c { animation: y 2s infinite; } }")).toBe(3);
    expect(spelled(".a { animation: nx-rise 1s var(--ease-out) 1; }")).toBe(0);
  });

  it("allows an infinite animation only for status: the working dots and a pose under [data-busy]", () => {
    const offenders = loopsOutsideTheMascot(sheets)
      .filter(({ selector }) => !isBusyLoop(selector))
      .map(({ file, selector, body }) => `${file}: ${selector} { ${body.replace(/\s+/g, " ").trim()} }`);
    expect(
      offenders,
      `decoration must not loop (it costs a software-composited frame sixty times a second on the desktop shell).\n` +
        `Play it once on arrival, or move it with the pointer, or react once to a hover or tap:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("steps every allowed loop, so it costs about a fifth of a smooth one", () => {
    for (const { file, selector, body } of loopsOutsideTheMascot(sheets)) {
      expect(body, `${file}: ${selector}`).toMatch(/var\(--ease-busy\)/);
    }
  });

  it("has no loop in the components either: inline styles, Web Animations, SVG animation", () => {
    const spellings = [
      /\binfinite\b/,
      /animationIterationCount/,
      /iterations\s*:\s*(Infinity|Number\.POSITIVE_INFINITY)/,
      /repeatCount\s*=\s*["'{]*\s*indefinite/,
    ];
    const offenders: string[] = [];
    for (const { file, text } of sources) {
      for (const spelling of spellings) {
        if (spelling.test(text)) offenders.push(`${file}: ${spelling}`);
      }
    }
    expect(offenders, `a loop in a component:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("has no Tailwind utility that loops (the spin, pulse, bounce and ping ones)", () => {
    // The class names are assembled on purpose: Tailwind scans this file as well (`content` in
    // tailwind.config.ts takes `./lib/**`), and would ship the very loop this test forbids.
    const loops = ["spin", "pulse", "bounce", "ping"].map((name) => `animate-${name}`);
    const offenders = sources.flatMap(({ file, text }) =>
      loops.filter((loop) => new RegExp(`(?<![\\w-])${loop}(?![\\w-])`).test(text)).map((loop) => `${file}: ${loop}`),
    );
    expect(offenders, `Tailwind loops:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

describe("decorative shapes arrive once and rest", () => {
  const shapeRules = flatRules(outsideReduced).filter(({ selectors }) =>
    selectors.some((selector) => /^\.float-shape(-spin)?$/.test(selector)),
  );

  it("settles each shape with a finite entrance that fills backwards", () => {
    expect(shapeRules.length, ".float-shape rules missing").toBeGreaterThan(1);
    const base = shapeRules.find(({ selectors }) => selectors.includes(".float-shape"));
    expect(base?.body).toMatch(/animation:\s*nx-settle\s+var\(--motion-5\)\s+var\(--ease-spring\)\s+backwards\s*;/);
    expect(base?.body).toMatch(/animation-delay:\s*calc\(var\(--i\)\s*\*\s*var\(--motion-stagger\)/);
    const spin = shapeRules.find(({ selectors }) => selectors.includes(".float-shape-spin"));
    expect(spin?.body).toMatch(/animation-name:\s*nx-settle-spin\s*;/);
    for (const { selectors, body } of shapeRules) {
      expect(body, selectors.join(", ")).not.toMatch(/\binfinite\b|animation-iteration-count/);
      expect(body, selectors.join(", ")).not.toMatch(/animation-fill-mode:\s*(both|forwards)/);
    }
  });

  it("ends both settle keyframes on the shape's own style, so nothing has to hold the last frame", () => {
    // The marker carries the brace: `@keyframes nx-settle` alone is also the start of `nx-settle-spin`.
    const last = (name: string) => blockAfter(css, `@keyframes ${name} {`).split("100%").pop() ?? "";
    for (const name of ["nx-settle", "nx-settle-spin"]) {
      for (const needle of [/opacity:\s*1/, /scale:\s*1/, /rotate:\s*0deg/]) {
        expect(last(name), `${name} must end on ${needle}`).toMatch(needle);
      }
    }
    expect(last("nx-settle")).toMatch(/translate:\s*0 0/);
  });

  it("moves shapes with the pointer only through the hero's coalesced custom properties", () => {
    const live = flatRules(outsideReduced).find(({ selectors }) =>
      selectors.includes(".float-shapes-live .float-shape"),
    );
    expect(live?.body).toMatch(/transform:\s*translate\(/);
    expect(live?.body).not.toMatch(/animation/);
    expect(live?.body).toMatch(/transition:\s*transform\s+var\(--motion-\d\)\s+var\(--ease-out\)/);
  });
});

describe("cards that carry an entrance", () => {
  it("keep `translate: none` on hover and press, as they did while the entrance's fill held it", () => {
    const compat = /(\.card-live:is\(\.enter-rise[^{}]*)\{([^{}]*)\}/.exec(outsideReduced);
    expect(compat, "the .card-live + .enter-* rule is missing").not.toBeNull();
    expect(compat?.[1].replace(/\s+/g, " ").trim()).toMatch(/:is\(:hover, :focus-visible, :active\)$/);
    expect(compat?.[2]).toMatch(/translate:\s*none\s*;/);
  });
});

describe("busy-state loops step", () => {
  it("defines the busy easing as a step function token", () => {
    expect(blockAfter(css, ":root")).toMatch(/--ease-busy:\s*steps\(\d+\)/);
  });

  it("steps the working dots", () => {
    const dots = flatRules(outsideReduced).find(({ selectors }) => selectors.includes(".pulse-dots > span"));
    expect(dots?.body).toMatch(/animation:[^;]*var\(--ease-busy\)[^;]*\binfinite\b/);
  });

  it("steps every loop of every mascot pose that means work is running", () => {
    const busyStates = MASCOT_STATES.filter((state) => isMascotBusy(state, "beside"));
    expect(busyStates.length).toBeGreaterThan(8);
    for (const state of busyStates) {
      const rules = infiniteRules.filter(({ selectors }) =>
        selectors.some((s) => s.includes(`[data-state="${state}"]`)),
      );
      expect(rules.length, `${state} has no loop to step`).toBeGreaterThan(0);
      for (const { body } of rules) {
        expect(body, `${state} loop must use --ease-busy`).toMatch(/var\(--ease-busy\)/);
      }
    }
  });
});

describe("entrances", () => {
  const entrance = flatRules(outsideReduced).find(
    ({ selectors }) => selectors.includes(".enter-rise") && selectors.includes(".enter-pop"),
  );

  it("fills backwards only: the last keyframe is the element's own style, so nothing needs to hold it", () => {
    expect(entrance, ".enter-* base rule missing").toBeDefined();
    expect(entrance?.body).toMatch(/animation-fill-mode:\s*backwards\s*;/);
    for (const { selectors, body } of flatRules(outsideReduced)) {
      if (selectors.some((s) => s.startsWith(".enter-"))) {
        expect(body, selectors.join(", ")).not.toMatch(/animation-fill-mode:\s*(both|forwards)/);
      }
    }
  });

  it("caps the stagger, so a list of hundreds does not hold its last row back for seconds", () => {
    expect(entrance?.body).toMatch(
      /animation-delay:\s*calc\(min\(var\(--i\),\s*\d+\)\s*\*\s*var\(--motion-stagger\)\)/,
    );
  });

  it("ends every entrance keyframe on the element's natural style", () => {
    // `backwards` drops the last keyframe once the entrance ends, so it must be the identity.
    const natural: Record<string, RegExp[]> = {
      "nx-rise": [/opacity:\s*1/, /translate:\s*0 0/],
      "nx-fade": [/opacity:\s*1/],
      "nx-pop": [/opacity:\s*1/, /scale:\s*1/],
      "nx-slide-in": [/opacity:\s*1/, /translate:\s*0 0/],
    };
    for (const [name, needles] of Object.entries(natural)) {
      const last = blockAfter(css, `@keyframes ${name}`).split("100%").pop() ?? "";
      for (const needle of needles) {
        expect(last, `${name} must end on ${needle}`).toMatch(needle);
      }
    }
  });
});
