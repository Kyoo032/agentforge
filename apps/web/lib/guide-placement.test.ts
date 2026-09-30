import { describe, expect, it } from "vitest";
import {
  GUIDE_GAP,
  GUIDE_MARGIN,
  centered,
  isAnchorVisible,
  placeGuideCard,
  type GuidePlacement,
  type GuideRect,
  type GuideSize,
} from "./guide-placement";

const CARD: GuideSize = { width: 352, height: 220 };
const DESKTOP: GuideSize = { width: 1280, height: 800 };
const HALF: GuideSize = { width: 683, height: 800 };
const PHONE: GuideSize = { width: 375, height: 667 };

function inside(placed: { left: number; top: number }, card: GuideSize, viewport: GuideSize): boolean {
  return (
    placed.left >= 0 &&
    placed.top >= 0 &&
    placed.left + card.width <= viewport.width &&
    placed.top + card.height <= viewport.height
  );
}

describe("placeGuideCard", () => {
  const railNav: GuideRect = { left: 0, top: 60, width: 232, height: 640 };
  const workspacesLink: GuideRect = { left: 8, top: 560, width: 208, height: 32 };

  it("puts the card to the right of the rail on a desktop window, near the top of a tall anchor", () => {
    const placed = placeGuideCard({ anchor: railNav, card: CARD, viewport: DESKTOP, preferred: "right" });

    expect(placed.placement).toBe("right");
    expect(placed.left).toBe(232 + GUIDE_GAP);
    expect(placed.top).toBe(60 + GUIDE_MARGIN);
    expect(inside(placed, CARD, DESKTOP)).toBe(true);
  });

  it("centres a small anchor's card on it, clamped inside the window", () => {
    const placed = placeGuideCard({ anchor: workspacesLink, card: CARD, viewport: DESKTOP, preferred: "right" });

    expect(placed.placement).toBe("right");
    expect(placed.top).toBe(560 + 16 - 110);
    expect(inside(placed, CARD, DESKTOP)).toBe(true);
  });

  it("still fits beside the rail in a 683px half-width window", () => {
    const placed = placeGuideCard({ anchor: railNav, card: CARD, viewport: HALF, preferred: "right" });

    expect(placed.placement).toBe("right");
    expect(inside(placed, CARD, HALF)).toBe(true);
  });

  it("becomes a sheet along the bottom at 375px when no side of a tall collapsed rail has room, so the rail stays visible", () => {
    const collapsed: GuideRect = { left: 0, top: 60, width: 68, height: 540 };
    const card: GuideSize = { width: 343, height: 230 };

    const placed = placeGuideCard({ anchor: collapsed, card, viewport: PHONE, preferred: "right" });

    expect(placed.placement).toBe("sheet");
    expect(inside(placed, card, PHONE)).toBe(true);
    expect(placed.left).toBe(Math.round((375 - 343) / 2));
    expect(placed.top).toBe(667 - 230 - GUIDE_MARGIN);
  });

  it("puts the sheet along the top instead when the bottom would cover the anchor (320px, tall card)", () => {
    const viewport: GuideSize = { width: 320, height: 640 };
    const card: GuideSize = { width: 296, height: 311 };
    const icon: GuideRect = { left: 4, top: 319, width: 51, height: 40 };

    const placed = placeGuideCard({ anchor: icon, card, viewport, preferred: "right" });

    expect(placed.placement).toBe("sheet");
    expect(placed.top).toBe(GUIDE_MARGIN);
    expect(inside(placed, card, viewport)).toBe(true);
    // The icon stays visible: at most the ring's own padding is under the card.
    expect(placed.top + card.height - icon.top).toBeLessThan(icon.height / 4);
  });

  it("sits under a collapsed rail's small icon at 375px", () => {
    const icon: GuideRect = { left: 18, top: 300, width: 32, height: 32 };
    const card: GuideSize = { width: 343, height: 230 };

    const placed = placeGuideCard({ anchor: icon, card, viewport: PHONE, preferred: "right" });

    expect(["bottom", "top"]).toContain(placed.placement);
    expect(inside(placed, card, PHONE)).toBe(true);
  });

  it("goes above the composer, then below it if there is no room above", () => {
    const composer: GuideRect = { left: 300, top: 640, width: 720, height: 110 };
    const above = placeGuideCard({ anchor: composer, card: CARD, viewport: DESKTOP, preferred: "top" });
    expect(above.placement).toBe("top");
    expect(above.top).toBe(640 - GUIDE_GAP - 220);

    const nearTop: GuideRect = { left: 300, top: 30, width: 720, height: 110 };
    const below = placeGuideCard({ anchor: nearTop, card: CARD, viewport: DESKTOP, preferred: "top" });
    expect(below.placement).toBe("bottom");
    expect(below.top).toBe(30 + 110 + GUIDE_GAP);
  });

  it("uses the opposite side when the preferred one has no room", () => {
    const right: GuideRect = { left: 1100, top: 300, width: 160, height: 40 };

    const placed = placeGuideCard({ anchor: right, card: CARD, viewport: DESKTOP, preferred: "right" });

    expect(placed.placement).toBe("left");
    expect(placed.left).toBe(1100 - GUIDE_GAP - 352);
  });

  it("centres when there is no anchor, when the anchor is empty, and when centre is asked for", () => {
    const expected = centered(CARD, DESKTOP);
    expect(placeGuideCard({ anchor: null, card: CARD, viewport: DESKTOP, preferred: "right" })).toEqual(expected);
    expect(
      placeGuideCard({ anchor: { left: 10, top: 10, width: 0, height: 0 }, card: CARD, viewport: DESKTOP, preferred: "right" }),
    ).toEqual(expected);
    expect(placeGuideCard({ anchor: railNav, card: CARD, viewport: DESKTOP, preferred: "center" })).toEqual(expected);
    expect(expected.placement).toBe("center");
  });

  it("centres when the anchor is scrolled entirely off screen", () => {
    const gone: GuideRect = { left: 8, top: 2000, width: 200, height: 32 };
    expect(placeGuideCard({ anchor: gone, card: CARD, viewport: DESKTOP, preferred: "right" }).placement).toBe("center");
  });

  it("never places a card outside the viewport, for any anchor and any window", () => {
    const viewports: GuideSize[] = [DESKTOP, HALF, PHONE, { width: 320, height: 480 }, { width: 900, height: 420 }];
    const sides: GuidePlacement[] = ["right", "left", "top", "bottom", "center", "sheet"];
    let checked = 0;
    for (const viewport of viewports) {
      const card: GuideSize = { width: Math.min(352, viewport.width - 24), height: 240 };
      for (let left = -50; left < viewport.width; left += 97) {
        for (let top = -20; top < viewport.height; top += 89) {
          for (const anchor of [
            { left, top, width: 40, height: 32 },
            { left, top, width: 232, height: 600 },
          ]) {
            for (const preferred of sides) {
              const placed = placeGuideCard({ anchor, card, viewport, preferred });
              checked += 1;
              expect(inside(placed, card, viewport), JSON.stringify({ viewport, anchor, preferred, placed })).toBe(true);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("isAnchorVisible", () => {
  it("wants a real box that touches the window", () => {
    expect(isAnchorVisible({ left: 0, top: 0, width: 10, height: 10 }, DESKTOP)).toBe(true);
    expect(isAnchorVisible(null, DESKTOP)).toBe(false);
    expect(isAnchorVisible({ left: 0, top: 0, width: 0, height: 10 }, DESKTOP)).toBe(false);
    expect(isAnchorVisible({ left: -50, top: 0, width: 40, height: 10 }, DESKTOP)).toBe(false);
    expect(isAnchorVisible({ left: 1280, top: 0, width: 40, height: 10 }, DESKTOP)).toBe(false);
  });
});
