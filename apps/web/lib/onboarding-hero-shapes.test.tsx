/**
 * The decorative shapes of the onboarding hero never lie on the character, the headline or the intro
 * text (2026-09-29 sweep). At 375 and 320 px wide the old layout had seven shapes scattered by percent
 * across a hero whose headline and intro fill the column: a squiggle touched the character, a square and
 * a dot sat on the intro text. Now every shape is in a band either side of the 96 px character, above the
 * headline, and the hero thins them by its own width the way the Chat hero does.
 *
 * Node has no layout engine, so the geometry is computed from the layout's own numbers against the
 * hero's fixed anatomy (2rem padding, 96 px character, `mt-4` headline). The live check is a browser
 * drive at 375 x 812 and 320 x 700: `.cursor/skills/verify-agentforge/features/onboarding.md`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FloatingShapes } from "@/components/floating-shapes";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]) => readFileSync(join(web, ...parts), "utf8").replace(/\r\n/g, "\n");
const css = read("app", "globals.css");

const REM = 16;
const MASCOT_PX = 96;
/** The hero's `py-8` and the character's box below it, then the headline's `mt-4`. */
const HEADLINE_TOP_PX = 2 * REM + MASCOT_PX + 1 * REM;

/** The narrowest hero that shows a tier: a 320 px phone minus the page margins, then the two container queries. */
const NARROWEST_PX: Record<1 | 2 | 3, number> = { 1: 272, 2: 26 * REM, 3: 44 * REM };

type Placed = { tier: 1 | 2 | 3; size: number; topPx: number | null; side: "left" | "right" | null; sidePct: number };

function shapes(): Placed[] {
  const html = renderToStaticMarkup(<FloatingShapes layout="hero" />);
  return [...html.matchAll(/<svg\b[^>]*>/g)].map(([tag]) => {
    const tier = Number(/data-tier="(\d)"/.exec(tag)?.[1]) as 1 | 2 | 3;
    const size = Number(/\bwidth="(\d+)"/.exec(tag)?.[1]);
    const top = /top:([\d.]+)rem/.exec(tag)?.[1];
    const side = /(left|right):([\d.]+)%/.exec(tag);
    return {
      tier,
      size,
      topPx: top === undefined ? null : Number(top) * REM,
      side: (side?.[1] as "left" | "right" | undefined) ?? null,
      sidePct: Number(side?.[2] ?? Number.NaN),
    };
  });
}

describe("onboarding hero shapes", () => {
  it("finds the shapes it audits", () => {
    const placed = shapes();
    expect(placed.length).toBeGreaterThanOrEqual(4);
    expect(placed.length).toBeLessThanOrEqual(6);
    for (const shape of placed) {
      expect([1, 2, 3]).toContain(shape.tier);
      expect(shape.size).toBeGreaterThan(0);
    }
  });

  it("shows only two shapes on a phone, where the column has no room for more", () => {
    expect(shapes().filter((shape) => shape.tier === 1)).toHaveLength(2);
  });

  it("anchors every shape from the top, in the character's band, and ends it above the headline", () => {
    for (const shape of shapes()) {
      expect(shape.topPx, "a shape anchored from the bottom would move onto the text as the text wraps").not.toBeNull();
      expect(shape.topPx ?? 0, "above the character's top edge").toBeGreaterThanOrEqual(2 * REM);
      expect((shape.topPx ?? 0) + shape.size, "reaches the headline").toBeLessThanOrEqual(HEADLINE_TOP_PX);
    }
  });

  it("keeps every shape out of the character's box at the narrowest hero that shows it", () => {
    for (const shape of shapes()) {
      expect(shape.side, "positioned from a side").not.toBeNull();
      const width = NARROWEST_PX[shape.tier];
      const inset = (shape.sidePct / 100) * width;
      const room = (width - MASCOT_PX) / 2;
      expect(inset + shape.size, `tier ${shape.tier} ${shape.side} ${shape.sidePct}% at ${width}px`).toBeLessThanOrEqual(
        room,
      );
    }
  });
});

describe("onboarding hero thinning", () => {
  it("makes the hero the size container its shapes are queried against, without naming it (a name is the composer's)", () => {
    expect(css).toMatch(/\.onboarding-hero \{[^}]*container-type:\s*inline-size/);
    expect(css).not.toMatch(/\.onboarding-hero \{[^}]*container-name/);
    expect(read("components", "onboarding-screen.tsx")).toMatch(/className="[^"]*\bonboarding-hero\b/);
  });

  it("hides tiers 2 and 3 until the hero is 26rem and 44rem wide", () => {
    expect(css).toMatch(
      /\.onboarding-hero \.float-shape\[data-tier="2"\],\s*\.onboarding-hero \.float-shape\[data-tier="3"\] \{[^}]*display:\s*none/,
    );
    expect(css).toMatch(/@container \(min-width: 26rem\) \{\s*\.onboarding-hero \.float-shape\[data-tier="2"\]/);
    expect(css).toMatch(/@container \(min-width: 44rem\) \{\s*\.onboarding-hero \.float-shape\[data-tier="3"\]/);
  });
});
