/**
 * The Chat header is one row at every width. Its chips (context, usage, account) sit beside the
 * title while they fit, and fold into one "Chat details" menu when they do not.
 *
 * Everything here is arithmetic and state, with no DOM, so it is testable in node:
 * `chat-header-fit.test.ts` holds it, and `use-chat-header-fit.ts` is the thin layer that reads
 * real widths and feeds them in. The mode is explicit state (`inline | menu`), never a breakpoint:
 * it is decided by what the title and the chips actually measure against the room the header has.
 */

export type HeaderMode = "inline" | "menu";

/**
 * The least the title may be squeezed to before the chips fold into the menu: room for about
 * eight characters of a long agent name. A short title ("Chat") asks for its own width instead.
 */
export const TITLE_FLOOR_PX = 120;

/**
 * Room the chips need beyond an exact fit to come back inline. Without it a width sitting on the
 * edge (a scrollbar appearing, a font finishing its load) would flip the header every frame.
 */
export const RETURN_MARGIN_PX = 12;

export type HeaderMeasure = {
  /** The header's content width: its box minus horizontal padding. */
  available: number;
  /** The title's natural, untruncated width. */
  title: number;
  /** The chips laid out in one row at their natural width. 0 when there are none. */
  controls: number;
  /** The column gap between the title and the chips. */
  gap: number;
};

export function titleFloor(titleNatural: number): number {
  if (!Number.isFinite(titleNatural) || titleNatural <= 0) {
    return 0;
  }
  return Math.min(titleNatural, TITLE_FLOOR_PX);
}

/** Width the header needs to hold the title at its floor and every chip beside it. */
export function inlineNeed(measure: HeaderMeasure): number {
  return titleFloor(measure.title) + Math.max(0, measure.gap) + measure.controls;
}

/**
 * The mode a header should be in, given the mode it is in.
 *
 * Inline folds as soon as the need exceeds the room; menu unfolds only when the room is the need
 * plus `RETURN_MARGIN_PX`. No chips means nothing to fold, so it is inline with no button. A header
 * that has no width (not laid out, `display: none` up the tree) keeps the mode it has.
 */
export function decideHeaderMode(current: HeaderMode, measure: HeaderMeasure): HeaderMode {
  if (!Number.isFinite(measure.available) || measure.available <= 0) {
    return current;
  }
  if (!Number.isFinite(measure.controls) || measure.controls <= 0) {
    return "inline";
  }
  const need = inlineNeed(measure);
  if (current === "inline") {
    return need > measure.available ? "menu" : "inline";
  }
  return need + RETURN_MARGIN_PX <= measure.available ? "inline" : "menu";
}

/** Who should hold focus after the state changes: the menu button, the first item, or nobody. */
export type HeaderFocus = "button" | "panel" | null;

export type HeaderState = {
  mode: HeaderMode;
  /** Only ever true in menu mode. */
  open: boolean;
  /**
   * Counts every change of `mode` or `open`. A chip keeps its own details open only for the epoch
   * it opened them in, so they are closed again the next time the layout changes, however it
   * changes, with no effect to run.
   */
  epoch: number;
  /** The focus the last event asked for; the view acts on it when `focusSeq` changes. */
  focus: HeaderFocus;
  focusSeq: number;
};

export const INITIAL_HEADER_STATE: HeaderState = { mode: "inline", open: false, epoch: 0, focus: null, focusSeq: 0 };

export type HeaderEvent =
  | { type: "fit"; mode: HeaderMode }
  | { type: "toggle" }
  | { type: "escape" }
  | { type: "outside" }
  | { type: "focus-out" }
  | { type: "pick" };

/**
 * The menu's whole behaviour as one reducer.
 *
 * - `toggle` (the button, by click, Enter or Space) opens and moves focus to the first item, or
 *   closes and leaves focus on the button the user just used.
 * - `escape` closes and returns focus to the button.
 * - `outside` (a pointer down elsewhere, or the header being hidden under the user), `focus-out`
 *   (Tab or a click moved focus elsewhere) and `pick` (a link in the menu was followed) close
 *   without moving focus, because the user already chose where it goes.
 * - `fit` changes the mode. A mode change always leaves the menu closed: going inline empties it,
 *   and going to a menu starts it shut.
 */
export function reduceHeader(state: HeaderState, event: HeaderEvent): HeaderState {
  const next = step(state, event);
  if (next !== state && (next.mode !== state.mode || next.open !== state.open)) {
    return { ...next, epoch: state.epoch + 1 };
  }
  return next;
}

function step(state: HeaderState, event: HeaderEvent): HeaderState {
  switch (event.type) {
    case "fit":
      if (event.mode === state.mode) {
        return state;
      }
      return { ...state, mode: event.mode, open: false, focus: null };
    case "toggle":
      if (state.mode !== "menu") {
        return state;
      }
      if (state.open) {
        return { ...state, open: false, focus: null };
      }
      return { ...state, open: true, focus: "panel", focusSeq: state.focusSeq + 1 };
    case "escape":
      if (!state.open) {
        return state;
      }
      return { ...state, open: false, focus: "button", focusSeq: state.focusSeq + 1 };
    case "outside":
    case "focus-out":
    case "pick":
      if (!state.open) {
        return state;
      }
      return { ...state, open: false, focus: null };
    default:
      return state;
  }
}

/**
 * Arrow-key travel through the menu's items. `current` is the index that holds focus, or -1 when
 * none does. Down and Up wrap; Home and End jump. Any other key is not the menu's.
 */
export function nextItemIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
