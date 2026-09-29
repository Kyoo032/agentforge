/**
 * The empty Chat hero and the Chat header, measured against the room they have.
 *
 * Node has no layout engine, so this cannot measure a width. It holds what a browser drive cannot
 * see go stale: the markup hooks the CSS depends on, the shape of the CSS (a query nothing
 * declares matches nothing, silently), and the motion rules that keep the hero cheap. The widths
 * and the interactions are driven live: `.cursor/skills/verify-agentforge/features/chat.md`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ChatHero } from "@/components/chat-hero";
import { applyLocale, resetLocaleForTests } from "./i18n";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(web, ...parts), "utf8").replace(/\r\n/g, "\n");
const css = read("app", "globals.css");
const launcher = read("components", "chat-launcher.tsx");
const session = read("components", "chat-session.tsx");

/** The declarations of the first rule whose selector is exactly `selector`, at any depth. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `${selector} must have a rule in globals.css`).not.toBeNull();
  return match?.[1] ?? "";
}

/** The text of the `@media (prefers-reduced-motion: reduce)` block, brace-matched. */
function reducedBlock(): string {
  const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(at).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error("reduced-motion block is unterminated");
}

function heroMarkup(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ChatHero />
    </MemoryRouter>,
  );
}

afterEach(() => resetLocaleForTests());

describe("hero markup", () => {
  it("keeps the ids the recipes and e2e read, and draws the Nultron character whole", () => {
    const html = heroMarkup();
    expect(html).toContain('data-testid="chat-hero"');
    expect(html).toContain('data-testid="chat-mascot"');
    expect(html).toContain('data-mascot="nultron"');
    expect(html).toContain(`data-variant="full"`);
    expect(html).toContain('data-testid="chat-key-status"');
    expect(html).toContain('data-mode="chat"');
  });

  it("starts the mascot idle, with no confetti mounted", () => {
    const html = heroMarkup();
    expect(html).toContain('data-testid="chat-hero-mascot"');
    expect(html).toContain('data-state="idle"');
    expect(html).not.toContain('class="confetti"');
  });

  it("names the mascot button in both languages", () => {
    applyLocale("en");
    expect(heroMarkup()).toContain('aria-label="Say hello"');
    applyLocale("id");
    expect(heroMarkup()).toContain('aria-label="Sapa"');
  });

  it("keeps the status on one line and gives it a title for the full text", () => {
    const html = heroMarkup();
    const pill = /<p class="chat-status-pill[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    expect(pill).toContain("whitespace-nowrap");
    expect(pill).toContain("max-w-full");
    expect(pill).toMatch(/title="[^"]+"/);
    expect(html).toMatch(/<span class="min-w-0 truncate">[^<]+<\/span>/);
  });

  it("draws seven shapes in three tiers, each with a drift depth", () => {
    const html = heroMarkup();
    const tiers = [...html.matchAll(/data-tier="(\d)"/g)].map((m) => m[1]);
    expect(tiers.sort()).toEqual(["1", "1", "2", "2", "2", "3", "3"]);
    expect(html).toContain("float-shapes-live");
    expect([...html.matchAll(/--depth:(-?\d+)/g)]).toHaveLength(7);
  });

  it("is what the launcher renders, with no second hero left behind", () => {
    expect(launcher).toContain("<ChatHero />");
    expect(launcher).not.toContain("hero-aurora");
    expect(launcher).not.toContain("FloatingShapes");
  });
});

describe("hero sizing follows the column, not the viewport", () => {
  it("makes the launcher column the size container", () => {
    expect(rule(".chat-empty-fit")).toContain("container-type: inline-size");
  });

  it("scales type, pill and spacing with cqi and never with viewport units", () => {
    for (const selector of [".chat-hero-title", ".chat-status-pill", ".chat-hero", ".chat-hero-orb"]) {
      const body = rule(selector);
      expect(body, selector).toMatch(/clamp\([^;]*cqi/);
      expect(body, selector).not.toMatch(/\d(vw|vh|dvh|svh|lvh)\b/);
    }
  });

  it("thins the shapes out by container width, and only inside the hero", () => {
    expect(rule('.chat-hero .float-shape[data-tier="2"],\n.chat-hero .float-shape[data-tier="3"]')).toContain(
      "display: none",
    );
    expect(css).toMatch(/@container \(min-width: 26rem\) \{[^@]*data-tier="2"/);
    expect(css).toMatch(/@container \(min-width: 44rem\) \{[^@]*data-tier="3"/);
  });
});

describe("hero motion is cheap and can be switched off", () => {
  it("pauses what still moves in the hero when it is off screen, and not the entrances", () => {
    const at = css.indexOf('.chat-hero[data-paused="true"]');
    expect(at).toBeGreaterThan(-1);
    const body = css.slice(at, css.indexOf("}", at));
    // The shapes settle once and rest (`lib/motion-tokens.test.ts`), so there is no loop of theirs to pause.
    expect(body).not.toContain(".float-shape");
    expect(body).toContain(".chat-mascot");
    expect(body).toContain("animation-play-state: paused");
    expect(body).not.toMatch(/\.enter-|\s\*\s*[,{]/);
  });

  it("outranks the mascot's own animation rules, whose shorthand would otherwise restart them", () => {
    // A mascot rule's `animation` shorthand resets `animation-play-state`, so a pause has to be more
    // specific than the rule it pauses, not merely equal to it. The hero's mascot is never `data-busy`, so
    // it has no loop, only the finite clips of `components/nultron/nultron.css`; this pause outranks the
    // SVG rig's (0,3,0) clips and not the image renderer's (0,5,0) ones, which is harmless: a clip is under
    // a second long.
    const selector = css.slice(
      css.indexOf('.chat-hero[data-paused="true"]'),
      css.indexOf("{", css.indexOf('.chat-hero[data-paused="true"]')),
    );
    const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length;
    expect(classes).toBeGreaterThanOrEqual(4);
  });

  it("moves shapes only with transform, only when the hero is live", () => {
    const shape = rule(".float-shapes-live .float-shape");
    expect(shape).toMatch(/transform: translate\(/);
    expect(shape).toContain("--px");
    expect(shape).toContain("var(--depth");
    expect(shape).toMatch(/transition: transform var\(--motion-\d\) var\(--ease-out\)/);
    expect(css).not.toMatch(/\n\.float-shape \{[^}]*--px/);
  });

  it("runs on tokens, not literal timings", () => {
    const heroCss = css
      .slice(css.indexOf(".chat-hero {"), css.indexOf("/* Off screen or in a hidden tab"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/var\(\s*--[\w-]+\s*\)/g, "");
    const timings = [...heroCss.matchAll(/\b(?:transition|animation)[\w-]*\s*:\s*([^;]+);/g)].map((m) => m[1]);
    expect(timings.length).toBeGreaterThan(0);
    for (const value of timings) {
      expect(value).not.toMatch(/(^|[\s,(])\d*\.?\d+m?s\b/);
      expect(value).not.toMatch(/\b(ease|ease-in|ease-out|ease-in-out|linear)\b|cubic-bezier\(/);
    }
  });

  it("puts every transformed rest state back under reduced motion", () => {
    const reduced = reducedBlock();
    for (const selector of [
      ".float-shapes-live .float-shape",
      ".chat-hero-orb:hover",
      ".chat-hero-orb:active",
      ".chat-hero-panel::after",
    ]) {
      expect(reduced, selector).toContain(selector);
    }
    expect(reduced).toMatch(/\.chat-hero-panel::after \{\s*display: none/);
  });

  it("follows the pointer only on a fine, hover-capable one", () => {
    expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.chat-hero-panel:hover::after/);
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.chat-hero-orb:hover/);
  });
});

describe("Chat header", () => {
  // The header is one row at every width (its chips fold into a menu instead of wrapping), drawn by
  // `components/chat-header.css`. Its own contract is `chat-header.test.tsx`; this holds that the
  // wrap rules are gone from the desk stylesheet and that the row is still a min-height, not a height.
  const headerCss = read("components", "chat-header.css");

  it("is one non-wrapping row with a minimum height, never a fixed one", () => {
    const declarations = /(?:^|\n)\.chat-header \{([^}]*)\}/.exec(headerCss)?.[1] ?? "";
    expect(declarations).toContain("flex-wrap: nowrap");
    expect(declarations).toContain("min-height: 3.5rem");
    expect(declarations).not.toMatch(/(^|[\s;])height:/);
    expect(declarations).not.toContain("container-type");
    const header = read("components", "chat-header.tsx");
    const before = header.slice(0, header.indexOf('data-testid="chat-header"'));
    const classes = before.slice(before.lastIndexOf("className="));
    expect(classes).toContain("chat-header ");
    expect(classes).not.toMatch(/\bh-14\b/);
  });

  it("no longer carries the wrapping rules, which lived in the desk stylesheet", () => {
    expect(css).not.toMatch(/(?:^|\n)\.chat-header(?:-controls)? \{/);
    expect(css).not.toContain("@container (max-width: 24rem)");
    expect(session).not.toContain("chat-header-controls");
  });

  it("lets every chip shrink to the row and truncate its label", () => {
    for (const file of ["chat-context-chip", "chat-usage-chip", "chat-account-chip"]) {
      const source = read("components", `${file}.tsx`);
      expect(source, file).toContain("max-w-full");
      expect(source, file).not.toContain('className="relative ml-auto');
      expect(source, file).not.toContain('className="relative flex-none');
    }
    expect(read("components", "chat-context-chip.tsx")).toContain('className="min-w-0 truncate text-xs');
    expect(read("components", "chat-usage-chip.tsx")).toContain('<span className="min-w-0 truncate">{label}</span>');
  });
});
