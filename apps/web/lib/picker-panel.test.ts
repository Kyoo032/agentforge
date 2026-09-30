import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PICKER_PANEL_GUTTER,
  PICKER_PANEL_MAX_HEIGHT,
  PICKER_PANEL_MIN_HEIGHT,
  PICKER_PANEL_WIDTH,
  placePickerPanel,
} from "./picker-panel";

const components = join(dirname(fileURLToPath(import.meta.url)), "..", "components");
const globalsCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css"),
  "utf8",
).replace(/\r\n/g, "\n");

/** The declarations of a top-level rule in `globals.css`. Layout for the composer lives there. */
function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(globalsCss)?.[1] ?? "";
}

const viewport = { width: 1280, height: 900 };
const bounds = { top: 8, bottom: 892, left: 8, right: 1272 };

function trigger(top: number, left = 200, width = 92) {
  return { top, bottom: top + 32, left, right: left + width, width };
}

describe("picker panel placement", () => {
  it("opens above the trigger when the composer sits near the bottom", () => {
    const pos = placePickerPanel(trigger(820), bounds, viewport);
    expect(pos.placement).toBe("above");
    expect(pos.top).toBeUndefined();
    expect(pos.bottom).toBe(viewport.height - 820 + PICKER_PANEL_GUTTER);
    expect(pos.maxHeight).toBe(PICKER_PANEL_MAX_HEIGHT);
  });

  it("flips below when there is no room above", () => {
    const pos = placePickerPanel(trigger(20), bounds, viewport);
    expect(pos.placement).toBe("below");
    expect(pos.bottom).toBeUndefined();
    expect(pos.top).toBe(52 + PICKER_PANEL_GUTTER);
  });

  it("keeps the panel inside the bounds on narrow panes", () => {
    const narrow = { top: 8, bottom: 892, left: 8, right: 208 };
    const pos = placePickerPanel(trigger(820, 180), narrow, viewport);
    expect(pos.width).toBe(200);
    expect(pos.left).toBe(8);
    expect(pos.left + pos.width).toBeLessThanOrEqual(narrow.right);
  });

  it("clamps a wide trigger to the full panel width and never overflows the right edge", () => {
    const pos = placePickerPanel(trigger(820, 1100), bounds, viewport);
    expect(pos.width).toBe(PICKER_PANEL_WIDTH);
    expect(pos.left + pos.width).toBeLessThanOrEqual(bounds.right);
  });

  it("never returns a panel shorter than the minimum height", () => {
    const squat = { top: 780, bottom: 892, left: 8, right: 1272 };
    const pos = placePickerPanel(trigger(820, 200), squat, viewport);
    expect(pos.maxHeight).toBe(PICKER_PANEL_MIN_HEIGHT);
  });
});

describe("model picker popover", () => {
  const source = readFileSync(join(components, "model-picker.tsx"), "utf8");
  const composer = readFileSync(join(components, "chat-composer.tsx"), "utf8");

  // Regression: the composer toolbar used to clip its left group (overflow-hidden), so an
  // absolutely positioned panel was invisible and un-clickable. It must be portalled.
  it("renders the option list through a portal", () => {
    expect(source).toContain("createPortal");
    expect(source).toContain("placePickerPanel");
    expect(source).not.toContain("absolute bottom-full");
  });

  // Regression: the same single-row toolbar squeezed the trigger to 18px on narrow panes.
  it("keeps a readable minimum width on the picker trigger", () => {
    // The floor was `min-w-[7rem]` and the trigger used to be a fixed `w-36`. Since 2026-09-23 it
    // is `min-width: 9rem; max-width: 18rem`, so it can grow into a long "Model: …" label but still
    // never collapse below a readable width. Since the composer became a container query the bounds
    // live in `.model-picker` (globals.css), not in utilities on the wrapper, because the narrow
    // layout has to release the floor and a utility would fight that. The assertion is on the
    // *floor*, not one literal, so a future tuning of the two bounds does not read as a regression.
    const picker = cssRule(".model-picker");
    const floor = /min-width:\s*(\d+)rem/.exec(picker);
    expect(floor, "the trigger must keep a min-width floor").not.toBeNull();
    expect(Number(floor?.[1])).toBeGreaterThanOrEqual(7);
    expect(picker).toContain("max-width: 18rem");
    expect(source).toContain('className="model-picker"');
    expect(source).not.toMatch(/min-w-\[|max-w-\[/);
    expect(source).not.toContain("relative min-w-0 max-w-[9rem] shrink");
  });

  it("lets the composer toolbar wrap instead of clipping its left group", () => {
    // The group is `.composer-controls`. Its wrapping and its lack of a clip are in the CSS now.
    expect(composer).toContain('className="composer-controls"');
    const group = cssRule(".composer-controls");
    expect(group).toContain("flex-wrap: wrap");
    expect(group).not.toContain("overflow");
  });
});
