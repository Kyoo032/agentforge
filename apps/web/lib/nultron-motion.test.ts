import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MASCOT_STATES, STATE_MOTION } from "./mascot-states";

/**
 * The Nultron mascot's motion contract (`components/nultron/nultron.css`). None of it shows in a
 * screenshot, and every line of it is a performance promise: the packaged Windows app has no GPU, so
 * a running loop costs a full software-composited frame sixty times a second.
 *
 *  - `still` states have no animation. `once` states play one finite clip of 600-1200 ms.
 *    `loop-busy` states loop only under `[data-busy]`, stepped.
 *  - Keyframes touch transform and opacity only, start and end at the identity (a frame strip ends where
 *    the strip does), and take their times and easings from the tokens.
 *  - No filter anywhere. Reduced motion removes the movement and keeps the picture.
 */

const nultronDir = join(dirname(fileURLToPath(import.meta.url)), "..", "components", "nultron");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const motionRaw = readFileSync(join(nultronDir, "nultron.css"), "utf8").replace(/\r\n/g, "\n");
const motion = strip(motionRaw);

/** The token the desk's motion scale defines (`--motion-4: 320ms` in app/globals.css). */
const MOTION_4_MS = 320;

function blockAfter(source: string, marker: string): string {
  const at = source.indexOf(marker);
  expect(at, `${marker} missing`).toBeGreaterThan(-1);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${marker} is unterminated`);
}

const reduced = blockAfter(motion, "@media (prefers-reduced-motion: reduce)");
const outsideReduced = motion.replace(reduced, "");

type Rule = { selectors: string[]; body: string };
const keyframeNames = [...motion.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);

function withoutKeyframes(source: string): string {
  let out = source;
  for (const name of keyframeNames) {
    out = out.replace(`@keyframes ${name} {${blockAfter(out, `@keyframes ${name}`)}}`, "");
  }
  return out;
}

const rules: Rule[] = [...withoutKeyframes(outsideReduced).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("@")),
  body: m[2],
}));

const animated = rules.filter(({ body }) => /(^|[\s;])animation\s*:/.test(body));
const isLoop = ({ body }: Rule) => /\binfinite\b/.test(body);
const label = (rule: Rule) => rule.selectors.join(", ");

describe("nultron motion: what may animate", () => {
  it("finds the rules it audits (guards the checks below)", () => {
    expect(keyframeNames.length).toBeGreaterThan(8);
    expect(animated.length).toBeGreaterThan(10);
    expect(animated.some(isLoop)).toBe(true);
    expect(animated.some((rule) => !isLoop(rule))).toBe(true);
  });

  it("runs every animation from a rule that starts at .chat-mascot, the root the desk's pause rules target", () => {
    for (const rule of animated) {
      for (const selector of rule.selectors) {
        expect(selector, selector).toMatch(/^\.chat-mascot\b/);
      }
    }
  });

  it("loops only under [data-busy], and steps every loop with --ease-busy", () => {
    for (const rule of animated.filter(isLoop)) {
      for (const selector of rule.selectors) {
        expect(selector, "a loop outside [data-busy] would run on an idle desk").toContain("[data-busy]");
      }
      expect(rule.body, label(rule)).toMatch(/var\(--ease-busy\)/);
    }
  });

  it("plays every other clip exactly once, for 600 to 1200 ms, from the motion tokens", () => {
    for (const rule of animated.filter((r) => !isLoop(r))) {
      const value = /animation\s*:\s*([^;]+);/.exec(rule.body)?.[1] ?? "";
      // A clip from the renders is as long as the manifest says, in beats of --motion-4 (default 3).
      const times = /calc\(var\(--motion-4\)\s*\*\s*(?:(\d+)|var\(--nx-clip-beats,\s*(\d+)\))\)/.exec(value);
      expect(times, `${label(rule)} must size its clip from --motion-4`).not.toBeNull();
      const ms = MOTION_4_MS * Number(times?.[1] ?? times?.[2]);
      expect(ms, label(rule)).toBeGreaterThanOrEqual(600);
      expect(ms, label(rule)).toBeLessThanOrEqual(1200);
      // `--nx-clip-ease` is `steps(frames, jump-none)`: one distinct position per frame.
      expect(value, label(rule)).toMatch(/var\(--(?:ease-out|nx-clip-ease)\)\s+1\s*$/);
    }
  });

  it("gives every state the motion it declares", () => {
    const clipsFor = (state: string) =>
      animated.filter((rule) => rule.selectors.some((selector) => selector.includes(`[data-state="${state}"]`)));
    for (const state of MASCOT_STATES) {
      const own = clipsFor(state);
      const kind = STATE_MOTION[state];
      if (kind === "still") {
        expect(own, `${state} is still and must not animate`).toEqual([]);
      } else if (kind === "once") {
        expect(own.length, `${state} needs a fallback clip for a render set with no strip`).toBeGreaterThan(0);
        expect(own.filter(isLoop), `${state} plays once`).toEqual([]);
      } else {
        expect(own.filter(isLoop).length, `${state} needs a fallback busy loop`).toBeGreaterThan(0);
        expect(own.filter((rule) => !isLoop(rule)), `${state} only loops`).toEqual([]);
      }
    }
  });

  it("plays a strip from the renders through its own rules: a clip once, a loop only while busy", () => {
    const clip = animated.filter((rule) => rule.selectors.some((s) => s.startsWith(".chat-mascot[data-clip]")));
    expect(clip.length, "the clip rules").toBeGreaterThanOrEqual(3);
    for (const rule of clip) {
      expect(rule.selectors.join(), label(rule)).toContain('[data-motion="once"]');
      expect(isLoop(rule), label(rule)).toBe(false);
    }
    const loop = animated.filter((rule) => rule.selectors.some((s) => s.includes(".nx-loop")));
    expect(loop.length).toBeGreaterThan(0);
    for (const rule of loop) {
      expect(rule.selectors.join(), label(rule)).toContain("[data-busy][data-loop]");
      expect(isLoop(rule), label(rule)).toBe(true);
    }
  });

  it("steps aside for a strip: the small transform motion applies only where the render has none", () => {
    for (const rule of animated.filter((r) => r.selectors.some((s) => s.includes('[data-state="')))) {
      for (const selector of rule.selectors) {
        expect(selector, selector).toMatch(isLoop(rule) ? /:not\(\[data-loop\]\)/ : /:not\(\[data-clip\]\)/);
      }
    }
  });

  it("animates only transform, opacity and the individual transform properties", () => {
    const banned = /\b(width|height|top|left|right|bottom|margin|padding|box-shadow|filter|background-position|fill|stroke|d)\s*:/;
    for (const name of keyframeNames) {
      for (const line of blockAfter(motion, `@keyframes ${name}`).split("\n")) {
        expect(line, `${name}: ${line.trim()}`).not.toMatch(banned);
      }
    }
  });

  it("starts and ends every small motion on the identity, so the still it returns to is the still it left", () => {
    const identity = /^(rotate:\s*0deg|translate:\s*0 0|scale:\s*1( 1)?|opacity:\s*1)$/;
    // A strip moves a whole picture across a window: it ends where the strip does, and the still
    // takes over again.
    for (const name of keyframeNames.filter((n) => !n.startsWith("nxm-strip-"))) {
      const body = blockAfter(motion, `@keyframes ${name}`);
      const stops = [...body.matchAll(/([\d.%,\s]+)\{([^{}]*)\}/g)].map((m) => ({
        at: m[1].split(",").map((s) => s.trim()),
        decls: m[2]
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
      }));
      const first = stops.find((stop) => stop.at.includes("0%"));
      const last = stops.find((stop) => stop.at.includes("100%"));
      expect(first, `${name} needs a 0% stop`).toBeDefined();
      expect(last, `${name} needs a 100% stop`).toBeDefined();
      for (const decl of [...(first?.decls ?? []), ...(last?.decls ?? [])]) {
        expect(decl, `${name}: ${decl}`).toMatch(identity);
      }
    }
  });

  it("writes no literal duration or easing", () => {
    const literal = /(^|[\s,(])\d*\.?\d+m?s\b|\b(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)\b|cubic-bezier\(|steps\(/;
    for (const match of outsideReduced.matchAll(/\b(animation|transition)(-[\w-]+)?\s*:\s*([^;]+);/g)) {
      const value = match[3].replace(/var\(\s*--[\w-]+\s*\)/g, "").replace(/var\(\s*--[\w-]+\s*,\s*[^)]*\)/g, "");
      expect(value, match[0]).not.toMatch(literal);
    }
  });
});

describe("nultron motion: no filters, and reduced motion", () => {
  it("uses no CSS filter, blur or drop shadow", () => {
    expect(motion).not.toMatch(/(^|[\s;{])(backdrop-)?filter\s*:|blur\(|drop-shadow\(/);
  });

  it("removes the movement and keeps the picture", () => {
    expect(reduced).toMatch(/\.chat-mascot\s*,\s*\.chat-mascot \*\s*\{[^}]*animation:\s*none\s*!important/);
    expect(reduced).toMatch(/transition:\s*none\s*!important/);
    expect(reduced).not.toMatch(/\btransform\s*:/);
  });

  it("shows the still, not frame 0 of the loop, when a busy mascot cannot move", () => {
    // Outside this block a busy mascot swaps its still for the loop strip. With the animation gone the
    // strip is one frame at 320 px against the still's 512, so the block puts the still back.
    // `!important`: the swap rules outside the block wait for `.nx-art[data-sheet]` and are more specific.
    expect(reduced).toMatch(/\.chat-mascot\[data-busy\]\[data-loop\] \.nx-still\s*\{[^}]*opacity:\s*1\s*!important/);
    expect(reduced).toMatch(/\.chat-mascot\[data-busy\]\[data-loop\] \.nx-loop\s*\{[^}]*opacity:\s*0\s*!important/);
    expect(outsideReduced).toMatch(
      /\.chat-mascot\[data-busy\]\[data-loop\] \.nx-art\[data-sheet\] \.nx-still\s*\{[^}]*opacity:\s*0/,
    );
  });
});

describe("nultron motion: a strip never plays over an empty box", () => {
  const stripRules = rules.filter((rule) =>
    rule.selectors.some((selector) => /\.nx-(strip|loop)\b/.test(selector) || selector.endsWith(".nx-still")),
  );
  // The rules that hide the still or show a strip. Fallback rules for a state with no strip are the other
  // `.nx-still` rules, and start at `:not([data-clip])` or `:not([data-loop])`.
  const takingOver = stripRules.filter((rule) =>
    rule.selectors.every(
      (selector) => selector.startsWith(".chat-mascot[data-clip]") || selector.includes("[data-busy][data-loop]"),
    ),
  );

  it("finds the rules it audits", () => {
    expect(takingOver.length).toBeGreaterThanOrEqual(6);
  });

  it("starts a clip, hides a still or shows a loop only under `.nx-art[data-sheet]`, once the strip is loaded and decoded", () => {
    for (const rule of takingOver) {
      for (const selector of rule.selectors) {
        expect(selector, "would play or swap before the strip can be painted").toContain(".nx-art[data-sheet]");
      }
    }
  });

  it("gives the held still no animation, so the previous state's picture holds still under the new one", () => {
    // The rule keys on the root's attributes, which are the new state's, so it cancels the held still's motion outright.
    expect(motion).toMatch(/\.nx-held \.nx-still \{[^}]*animation-name:\s*none\s*!important/);
    for (const rule of animated) {
      for (const selector of rule.selectors) {
        expect(selector, selector).not.toContain("nx-held");
      }
    }
  });
});
