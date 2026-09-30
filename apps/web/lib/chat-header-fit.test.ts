/**
 * The Chat header's fit and its menu, as arithmetic and state.
 *
 * Node has no layout engine, so what a browser measures is handed in as numbers here: the room the
 * header has, the title's natural width, the chips' natural width and the gap. The same decision
 * runs in the browser on the real widths (`use-chat-header-fit.ts`); the widths at which it folds are
 * driven live: `.cursor/skills/verify-agentforge/features/chat.md`, "Header".
 */
import { describe, expect, it } from "vitest";
import {
  INITIAL_HEADER_STATE,
  RETURN_MARGIN_PX,
  TITLE_FLOOR_PX,
  decideHeaderMode,
  inlineNeed,
  nextItemIndex,
  reduceHeader,
  titleFloor,
  type HeaderEvent,
  type HeaderMeasure,
  type HeaderMode,
  type HeaderState,
} from "./chat-header-fit";

// "Chat" at 28px is 62px wide; three chips and their gaps are 300px; the gap to the title is 16px.
const MEASURE: HeaderMeasure = { available: 400, title: 62, controls: 300, gap: 16 };

function fold(events: HeaderEvent[], from: HeaderState = INITIAL_HEADER_STATE): HeaderState {
  return events.reduce(reduceHeader, from);
}

describe("what the header needs to stay inline", () => {
  it("is the title at its floor, the gap and the chips", () => {
    expect(inlineNeed(MEASURE)).toBe(378);
  });

  it("asks a short title for its own width and a long one for no more than the floor", () => {
    expect(TITLE_FLOOR_PX).toBe(120);
    expect(titleFloor(62)).toBe(62);
    expect(titleFloor(540)).toBe(120);
    expect(titleFloor(0)).toBe(0);
    expect(titleFloor(Number.NaN)).toBe(0);
    expect(inlineNeed({ ...MEASURE, title: 540 })).toBe(436);
  });
});

describe("the mode is measured, never a breakpoint", () => {
  it("stays inline while the title and the chips fit, exactly at the edge included", () => {
    expect(decideHeaderMode("inline", MEASURE)).toBe("inline");
    expect(decideHeaderMode("inline", { ...MEASURE, available: 378 })).toBe("inline");
  });

  it("folds into the menu one pixel past the edge", () => {
    expect(decideHeaderMode("inline", { ...MEASURE, available: 377 })).toBe("menu");
  });

  it("folds a long title's header sooner than a short one's, because the floor is higher", () => {
    expect(decideHeaderMode("inline", { ...MEASURE, available: 400, title: 540 })).toBe("menu");
    expect(decideHeaderMode("inline", { ...MEASURE, available: 436, title: 540 })).toBe("inline");
  });

  it("unfolds only with the return margin to spare, so the edge cannot flicker", () => {
    expect(RETURN_MARGIN_PX).toBe(12);
    expect(decideHeaderMode("menu", { ...MEASURE, available: 389 })).toBe("menu");
    expect(decideHeaderMode("menu", { ...MEASURE, available: 390 })).toBe("inline");
  });

  it("does not flicker across a width that hovers on the edge", () => {
    // 380 fits (need 378), 377 does not, and back up through 385 and 389 it stays a menu until 390.
    const widths = [380, 377, 380, 385, 389, 390, 386, 380, 378, 377];
    const modes: HeaderMode[] = [];
    let mode: HeaderMode = "inline";
    for (const available of widths) {
      mode = decideHeaderMode(mode, { ...MEASURE, available });
      modes.push(mode);
    }
    expect(modes).toEqual(["inline", "menu", "menu", "menu", "menu", "inline", "inline", "inline", "inline", "menu"]);
  });

  it("re-evaluates when the chip set changes: the usage chip arriving after the first reply", () => {
    const room = { available: 400, title: 62, gap: 16 };
    // Before the first reply: only the account chip, 90px. It fits.
    expect(decideHeaderMode("inline", { ...room, controls: 90 })).toBe("inline");
    // After it: the context chip (164), the usage chip (138) and the account chip (90) with 12px gaps.
    expect(decideHeaderMode("inline", { ...room, controls: 164 + 138 + 90 + 24 })).toBe("menu");
  });

  it("has no menu to show when there are no chips", () => {
    expect(decideHeaderMode("menu", { ...MEASURE, controls: 0 })).toBe("inline");
    expect(decideHeaderMode("inline", { ...MEASURE, controls: 0, available: 10 })).toBe("inline");
  });

  it("keeps the mode it has while the header has no width to measure", () => {
    expect(decideHeaderMode("menu", { ...MEASURE, available: 0 })).toBe("menu");
    expect(decideHeaderMode("inline", { ...MEASURE, available: -8 })).toBe("inline");
    expect(decideHeaderMode("menu", { ...MEASURE, available: Number.NaN })).toBe("menu");
  });
});

describe("the menu's behaviour", () => {
  const MENU: HeaderState = fold([{ type: "fit", mode: "menu" }]);

  it("starts inline with the menu shut and nobody asked to take focus", () => {
    expect(INITIAL_HEADER_STATE).toEqual({ mode: "inline", open: false, epoch: 0, focus: null, focusSeq: 0 });
  });

  it("goes to the menu shut", () => {
    expect(MENU).toEqual({ mode: "menu", open: false, epoch: 1, focus: null, focusSeq: 0 });
  });

  it("opens from the button and asks for the first item to take focus", () => {
    expect(fold([{ type: "toggle" }], MENU)).toEqual({
      mode: "menu",
      open: true,
      epoch: 2,
      focus: "panel",
      focusSeq: 1,
    });
  });

  it("closes on Escape and asks for focus back on the button", () => {
    const open = fold([{ type: "toggle" }], MENU);
    expect(fold([{ type: "escape" }], open)).toEqual({
      mode: "menu",
      open: false,
      epoch: 3,
      focus: "button",
      focusSeq: 2,
    });
  });

  it("closes on a second press of the button without moving focus off it", () => {
    const open = fold([{ type: "toggle" }], MENU);
    expect(fold([{ type: "toggle" }], open)).toMatchObject({ open: false, focus: null });
  });

  it("closes on a press outside, focus moving outside, or a link followed, and leaves focus where the user put it", () => {
    const open = fold([{ type: "toggle" }], MENU);
    for (const type of ["outside", "focus-out", "pick"] as const) {
      expect(fold([{ type }], open)).toMatchObject({ open: false, focus: null, focusSeq: 1 });
    }
  });

  it("ignores Escape and outside presses when the menu is already shut", () => {
    for (const type of ["escape", "outside", "focus-out", "pick"] as const) {
      expect(fold([{ type }], MENU)).toBe(MENU);
    }
  });

  it("has no menu to toggle while inline", () => {
    expect(fold([{ type: "toggle" }])).toBe(INITIAL_HEADER_STATE);
  });

  it("shuts the menu when the row unfolds, so it is never left open over an inline row", () => {
    const open = fold([{ type: "toggle" }], MENU);
    expect(fold([{ type: "fit", mode: "inline" }], open)).toMatchObject({ mode: "inline", open: false });
  });

  it("counts every change of mode or of open, so a chip's own details close with each one", () => {
    const events: HeaderEvent[] = [
      { type: "fit", mode: "menu" },
      { type: "toggle" },
      { type: "escape" },
      { type: "toggle" },
      { type: "pick" },
      { type: "toggle" },
      { type: "fit", mode: "inline" },
    ];
    const epochs = events.map((_, index) => fold(events.slice(0, index + 1)).epoch);
    expect(epochs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the epoch when nothing changed", () => {
    expect(fold([{ type: "escape" }], MENU).epoch).toBe(1);
    expect(fold([{ type: "toggle" }]).epoch).toBe(0);
    expect(fold([{ type: "fit", mode: "menu" }], MENU).epoch).toBe(1);
  });

  it("does nothing for a fit that changes no mode", () => {
    const open = fold([{ type: "toggle" }], MENU);
    expect(fold([{ type: "fit", mode: "menu" }], open)).toBe(open);
  });
});

describe("arrow keys through the items", () => {
  it("moves down and up, wrapping at both ends", () => {
    expect(nextItemIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextItemIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextItemIndex("ArrowUp", 2, 3)).toBe(1);
    expect(nextItemIndex("ArrowUp", 0, 3)).toBe(2);
  });

  it("starts at the first item going down and the last going up when none holds focus", () => {
    expect(nextItemIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextItemIndex("ArrowUp", -1, 3)).toBe(2);
  });

  it("jumps with Home and End and leaves every other key alone", () => {
    expect(nextItemIndex("Home", 2, 3)).toBe(0);
    expect(nextItemIndex("End", 0, 3)).toBe(2);
    expect(nextItemIndex("Tab", 0, 3)).toBeNull();
    expect(nextItemIndex("Enter", 0, 3)).toBeNull();
    expect(nextItemIndex("ArrowDown", 0, 0)).toBeNull();
  });
});
