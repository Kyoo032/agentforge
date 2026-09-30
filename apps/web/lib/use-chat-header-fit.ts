"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  type HeaderMeasure,
  INITIAL_HEADER_STATE,
  decideHeaderMode,
  nextItemIndex,
  reduceHeader,
} from "@/lib/chat-header-fit";

const ITEM_SELECTOR = "a[href], button:not([disabled])";

function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The header's room, the title's natural width and the gap between them, read from the live boxes. */
export function readHeaderMeasure(header: HTMLElement, title: HTMLElement, controlsWidth: number): HeaderMeasure {
  const style = getComputedStyle(header);
  return {
    available: header.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
    // A truncated title reports the full text as its scroll width, so this is the untruncated width.
    title: title.scrollWidth,
    controls: controlsWidth,
    gap: px(style.columnGap),
  };
}

function itemsIn(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : [];
}

/**
 * The Chat header's fit: measures the room, decides `inline | menu`, and runs the menu.
 *
 * The chips are one element, `controlsRef`, that never leaves the tree: inline it is a row beside
 * the title, in menu mode it is the panel (open) or the same row laid out but unseen (closed), so it
 * can still be measured. That is what keeps each chip mounted once. The chips' natural width is read
 * whenever the panel is not open, because open the chips are stacked in it and the width means
 * something else; the last natural width stands in until it closes.
 *
 * Re-evaluation is by observation, never by a viewport number: the header, the title and the
 * chips are each observed, and the chips' children too, so the usage chip arriving after the first
 * reply, a label growing, or a font finishing its load all fold or unfold the row the same way a
 * resize does.
 */
export function useChatHeaderFit() {
  const [state, dispatch] = useReducer(reduceHeader, INITIAL_HEADER_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const naturalRef = useRef(0);

  const evaluate = useCallback((sync: boolean) => {
    const header = headerRef.current;
    const title = titleRef.current;
    const controls = controlsRef.current;
    if (!header || !title || !controls) {
      return;
    }
    const current = stateRef.current;
    // The desk keeps a pane mounted while another route shows. A menu left open in a pane that has
    // just been hidden would still be open when the person comes back, so it shuts as the pane goes.
    if (current.open && header.clientWidth === 0) {
      dispatch({ type: "outside" });
      return;
    }
    // `offsetWidth`, not a bounding rect: the page's enter animation scales the desk for a moment, and
    // a scaled rect would understate the chips for as long as nothing resizes.
    const controlsWidth = current.open
      ? naturalRef.current
      : controls.childElementCount === 0
        ? 0
        : controls.offsetWidth;
    naturalRef.current = controlsWidth;
    const next = decideHeaderMode(current.mode, readHeaderMeasure(header, title, controlsWidth));
    if (next === current.mode) {
      return;
    }
    // A frame painted in the old mode would show the chips across the title, so a change made from
    // an observer is committed before that paint. The first read runs inside a layout effect, which
    // React already flushes before paint, and must not call flushSync from there.
    if (sync) {
      flushSync(() => dispatch({ type: "fit", mode: next }));
    } else {
      dispatch({ type: "fit", mode: next });
    }
  }, []);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const title = titleRef.current;
    const controls = controlsRef.current;
    if (!header || !title || !controls) {
      return;
    }
    evaluate(false);
    const run = () => evaluate(true);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(run);
    resize?.observe(header);
    resize?.observe(title);
    resize?.observe(controls);
    const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(run);
    mutation?.observe(controls, { childList: true });
    if (!resize) {
      window.addEventListener("resize", run);
    }
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener("resize", run);
    };
  }, [evaluate]);

  // The focus the last event asked for: the first item after an open, the button after Escape.
  useEffect(() => {
    if (state.focusSeq === 0) {
      return;
    }
    if (state.focus === "button") {
      buttonRef.current?.focus();
    } else if (state.focus === "panel") {
      itemsIn(controlsRef.current)[0]?.focus();
    }
  }, [state.focus, state.focusSeq]);

  // While the menu is open: Escape, a press outside, or focus moving outside close it.
  useEffect(() => {
    if (!state.open) {
      return;
    }
    const inside = (node: Node | null) =>
      Boolean(node && (controlsRef.current?.contains(node) || buttonRef.current?.contains(node)));
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target as Node | null)) {
        dispatch({ type: "outside" });
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!inside(event.target as Node | null)) {
        dispatch({ type: "focus-out" });
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "escape" });
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [state.open]);

  const toggle = useCallback(() => dispatch({ type: "toggle" }), []);

  const onButtonKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" && !stateRef.current.open) {
      event.preventDefault();
      dispatch({ type: "toggle" });
    }
  }, []);

  // Following a link (Usage) leaves the page, and the pane stays mounted behind the next route:
  // the menu must not still be open when the person comes back.
  const onPanelClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a[href]")) {
      dispatch({ type: "pick" });
    }
  }, []);

  const onPanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const items = itemsIn(controlsRef.current);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = nextItemIndex(event.key, index, items.length);
    if (next === null) {
      return;
    }
    event.preventDefault();
    items[next]?.focus();
  }, []);

  return { state, headerRef, titleRef, controlsRef, buttonRef, toggle, onButtonKeyDown, onPanelClick, onPanelKeyDown };
}
