/**
 * The keyboard contract of the guide, as pure functions so it can be tested without a DOM.
 *
 * The tour is a modal dialog: the rest of the app is inert while it is open, so every key that means
 * anything to it arrives at `document`, where `components/guide-tour.tsx` asks this what to do.
 *
 * - Escape closes it, from anywhere.
 * - Tab and Shift+Tab move through the card's controls and wrap; they never leave the card.
 * - ArrowRight is Next and ArrowLeft is Back while focus is in the card.
 * - Enter, with focus on the card itself rather than on one of its buttons, is Next. Focus lands on
 *   the card when the tour opens, so a person who only presses Enter can walk the whole tour.
 *   (Enter or Space on a button does what that button says: the browser does that.)
 */
export type GuideKeyAction = "close" | "next" | "back" | "tab" | "shift-tab" | null;

/**
 * A key held down repeats, and the tour must not: Enter held on the card, or on Next, would walk
 * through every stop and record the tour as finished before the person read one. The keys that step
 * the tour (and Space, which presses a button) are swallowed while repeating; everything else,
 * Escape included, behaves as usual.
 */
export function swallowsRepeat(event: { readonly key: string; readonly repeat?: boolean }): boolean {
  return event.repeat === true && (event.key === "Enter" || event.key === " " || event.key === "ArrowRight" || event.key === "ArrowLeft");
}

export type GuideKeyEvent = {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
};

export type GuideKeyContext = {
  /** Focus is somewhere in the card, buttons included. */
  readonly insideCard: boolean;
  /** Focus is on the card element itself, not on a control inside it. */
  readonly onCardItself: boolean;
  /** There is a step before this one. */
  readonly canBack: boolean;
};

export function guideKeyAction(event: GuideKeyEvent, context: GuideKeyContext): GuideKeyAction {
  const modified = event.altKey || event.ctrlKey || event.metaKey;
  switch (event.key) {
    case "Escape":
      return "close";
    case "Tab":
      return modified ? null : event.shiftKey ? "shift-tab" : "tab";
    case "ArrowRight":
      return !modified && context.insideCard ? "next" : null;
    case "ArrowLeft":
      return !modified && context.insideCard && context.canBack ? "back" : null;
    case "Enter":
      return !modified && context.onCardItself ? "next" : null;
    default:
      return null;
  }
}

/**
 * Where Tab goes next among `count` focusable controls when the trap has to decide: `current` is the
 * index of the focused one, or `-1` when focus is on the card itself or outside it. Wraps at both
 * ends. Returns `-1` when there is nothing to focus.
 */
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) {
    return -1;
  }
  if (current < 0) {
    return backwards ? count - 1 : 0;
  }
  if (backwards) {
    return current === 0 ? count - 1 : current - 1;
  }
  return current === count - 1 ? 0 : current + 1;
}

/** True when the trap has to take over: the browser's own Tab would step out of the card. */
export function tabWouldLeave(current: number, count: number, backwards: boolean, onCardItself: boolean): boolean {
  if (count <= 0) {
    return true;
  }
  if (current < 0) {
    // On the card itself, Tab goes to the first control and Shift+Tab out; outside, both must come in.
    return backwards || !onCardItself;
  }
  return backwards ? current === 0 : current === count - 1;
}
