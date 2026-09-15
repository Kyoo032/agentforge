/**
 * Placement for the composer model picker popover.
 *
 * The composer toolbar clips its left group so the trigger row stays on one line,
 * so the option list is portalled to the body and positioned here instead of being
 * absolutely positioned inside the (clipping) toolbar.
 */

export const PICKER_PANEL_WIDTH = 352;
export const PICKER_PANEL_GUTTER = 8;
export const PICKER_PANEL_MIN_HEIGHT = 160;
export const PICKER_PANEL_MAX_HEIGHT = 344;

export type TriggerRect = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
};

export type PanelBounds = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type Viewport = {
  width: number;
  height: number;
};

export type PickerPanelPos = {
  placement: "above" | "below";
  /** Set when the panel opens downward; `undefined` otherwise. */
  top?: number;
  /** Set when the panel opens upward; `undefined` otherwise. */
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function viewportBounds(viewport: Viewport): PanelBounds {
  return {
    top: PICKER_PANEL_GUTTER,
    bottom: Math.max(PICKER_PANEL_GUTTER, viewport.height - PICKER_PANEL_GUTTER),
    left: PICKER_PANEL_GUTTER,
    right: Math.max(PICKER_PANEL_GUTTER, viewport.width - PICKER_PANEL_GUTTER),
  };
}

export function placePickerPanel(trigger: TriggerRect, bounds: PanelBounds, viewport: Viewport): PickerPanelPos {
  const available = Math.max(0, bounds.right - bounds.left);
  const width = Math.min(PICKER_PANEL_WIDTH, available);
  const left = clamp(trigger.left, bounds.left, bounds.right - width);

  const spaceAbove = Math.max(0, trigger.top - PICKER_PANEL_GUTTER - bounds.top);
  const spaceBelow = Math.max(0, bounds.bottom - trigger.bottom - PICKER_PANEL_GUTTER);
  const above = spaceAbove >= PICKER_PANEL_MIN_HEIGHT || spaceAbove >= spaceBelow;
  const space = above ? spaceAbove : spaceBelow;
  const maxHeight = clamp(space, PICKER_PANEL_MIN_HEIGHT, PICKER_PANEL_MAX_HEIGHT);

  if (above) {
    return {
      placement: "above",
      bottom: viewport.height - trigger.top + PICKER_PANEL_GUTTER,
      left,
      width,
      maxHeight,
    };
  }
  return {
    placement: "below",
    top: trigger.bottom + PICKER_PANEL_GUTTER,
    left,
    width,
    maxHeight,
  };
}
