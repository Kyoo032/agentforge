import { describe, expect, it } from "vitest";
import {
  guideKeyAction,
  nextFocusIndex,
  swallowsRepeat,
  tabWouldLeave,
  type GuideKeyContext,
  type GuideKeyEvent,
} from "./guide-keys";

const plain: Omit<GuideKeyEvent, "key"> = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const inCard: GuideKeyContext = { insideCard: true, onCardItself: false, canBack: true };
const onCard: GuideKeyContext = { insideCard: true, onCardItself: true, canBack: true };
const outside: GuideKeyContext = { insideCard: false, onCardItself: false, canBack: true };

function key(name: string, extra: Partial<GuideKeyEvent> = {}): GuideKeyEvent {
  return { ...plain, key: name, ...extra };
}

describe("guideKeyAction", () => {
  it("closes on Escape wherever focus is", () => {
    for (const context of [inCard, onCard, outside]) {
      expect(guideKeyAction(key("Escape"), context)).toBe("close");
    }
  });

  it("maps Tab and Shift+Tab to the trap", () => {
    expect(guideKeyAction(key("Tab"), inCard)).toBe("tab");
    expect(guideKeyAction(key("Tab", { shiftKey: true }), inCard)).toBe("shift-tab");
    expect(guideKeyAction(key("Tab", { ctrlKey: true }), inCard)).toBeNull();
  });

  it("steps with the arrow keys inside the card, and never past the first step", () => {
    expect(guideKeyAction(key("ArrowRight"), inCard)).toBe("next");
    expect(guideKeyAction(key("ArrowLeft"), inCard)).toBe("back");
    expect(guideKeyAction(key("ArrowLeft"), { ...inCard, canBack: false })).toBeNull();
    expect(guideKeyAction(key("ArrowRight"), outside)).toBeNull();
    expect(guideKeyAction(key("ArrowRight", { altKey: true }), inCard)).toBeNull();
  });

  it("treats Enter as Next only when focus is on the card itself", () => {
    expect(guideKeyAction(key("Enter"), onCard)).toBe("next");
    expect(guideKeyAction(key("Enter"), inCard)).toBeNull();
    expect(guideKeyAction(key("Enter"), outside)).toBeNull();
  });

  it("ignores every other key", () => {
    for (const other of ["a", " ", "ArrowUp", "ArrowDown", "Home", "F5", "Backspace"]) {
      expect(guideKeyAction(key(other), inCard)).toBeNull();
    }
  });
});

describe("swallowsRepeat", () => {
  it("swallows a held Enter, Space or arrow, so one press is one stop", () => {
    for (const key of ["Enter", " ", "ArrowRight", "ArrowLeft"]) {
      expect(swallowsRepeat({ key, repeat: true }), key).toBe(true);
      expect(swallowsRepeat({ key, repeat: false }), key).toBe(false);
      expect(swallowsRepeat({ key }), key).toBe(false);
    }
  });

  it("leaves every other key alone, Escape and Tab included", () => {
    for (const key of ["Escape", "Tab", "a", "ArrowUp"]) {
      expect(swallowsRepeat({ key, repeat: true }), key).toBe(false);
    }
  });
});

describe("nextFocusIndex", () => {
  it("wraps forwards and backwards over the card's controls", () => {
    expect(nextFocusIndex(0, 4, false)).toBe(1);
    expect(nextFocusIndex(3, 4, false)).toBe(0);
    expect(nextFocusIndex(0, 4, true)).toBe(3);
    expect(nextFocusIndex(2, 4, true)).toBe(1);
  });

  it("enters from the card or from outside at the right end", () => {
    expect(nextFocusIndex(-1, 4, false)).toBe(0);
    expect(nextFocusIndex(-1, 4, true)).toBe(3);
  });

  it("answers -1 when there is nothing to focus", () => {
    expect(nextFocusIndex(-1, 0, false)).toBe(-1);
    expect(nextFocusIndex(0, 0, true)).toBe(-1);
  });
});

describe("tabWouldLeave", () => {
  it("is true at the ends of the card's controls", () => {
    expect(tabWouldLeave(3, 4, false, false)).toBe(true);
    expect(tabWouldLeave(0, 4, true, false)).toBe(true);
    expect(tabWouldLeave(1, 4, false, false)).toBe(false);
    expect(tabWouldLeave(1, 4, true, false)).toBe(false);
  });

  it("lets Tab from the card itself go to its first control, but not Shift+Tab out", () => {
    expect(tabWouldLeave(-1, 4, false, true)).toBe(false);
    expect(tabWouldLeave(-1, 4, true, true)).toBe(true);
  });

  it("pulls focus in from outside the card in both directions", () => {
    expect(tabWouldLeave(-1, 4, false, false)).toBe(true);
    expect(tabWouldLeave(-1, 4, true, false)).toBe(true);
  });

  it("takes over when the card has no controls at all", () => {
    expect(tabWouldLeave(-1, 0, false, true)).toBe(true);
  });
});
