import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ProductMode } from "@agentforge/core/product-modes";
import { GuideCard } from "@/components/guide-card";
import { GUIDE_STEPS, guideContextFor, listFormatter, type GuideStep } from "@/lib/guide-steps";
import { isGuideOpen, type GuideOpenState } from "@/lib/guide-machine";
import { guideKeyAction, nextFocusIndex, swallowsRepeat, tabWouldLeave } from "@/lib/guide-keys";
import {
  GUIDE_MARGIN,
  isAnchorVisible,
  placeGuideCard,
  type GuidePlacement,
  type GuideRect,
} from "@/lib/guide-placement";
import { dispatchGuide, getGuideSnapshot, subscribeGuide } from "@/lib/guide-store";
import { getLocale, t } from "@/lib/i18n";
import { useProductBrand } from "@/lib/product-brand";

/**
 * The first-run guide on screen: a dimmed desk with a ring around the thing being pointed at and one
 * card beside it. Mounted once, in the app shell; it draws nothing until the store says the tour is
 * open (`guide-store.ts`), and everything it does while open is undone when it closes.
 *
 * WHAT "OPEN" DOES TO THE PAGE. The app root is made `inert`, so nothing behind the card can be
 * clicked, tabbed to or read by a screen reader, and a click on the dimmed desk does nothing: it does
 * not advance, and it does not close. A person leaves the tour by its own controls (Skip, the close
 * button, Escape), never by a stray click. Focus moves onto the card when it opens and goes back to
 * where it was when it closes.
 *
 * WHERE THE CARD GOES. `guide-placement.ts`, from the anchor's measured box. The anchor is looked up
 * again on a short timer and on resize and scroll, because the desk is alive behind it (the Chat
 * hero is still settling when the composer step opens, a window can be resized mid-tour). An anchor
 * that is not there, or not visible, is a centred card and the tour goes on.
 *
 * NOTHING HERE LOOPS. The timer runs only while the tour is open, and no animation repeats.
 */

/** A dark scrim in both themes; `--text` flips to near-white on the dark desk. */
const SCRIM = "color-mix(in srgb, black 52%, transparent)";
const CARD_MAX_WIDTH = 352;
const RING_PAD = 4;
const REMEASURE_MS = 400;

type Measure = {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly cardHeight: number;
  readonly anchor: GuideRect | null;
};

const UNMEASURED: Measure = { viewportWidth: 0, viewportHeight: 0, cardHeight: 0, anchor: null };

function sameRect(a: GuideRect | null, b: GuideRect | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function sameMeasure(a: Measure, b: Measure): boolean {
  return (
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.cardHeight === b.cardHeight &&
    sameRect(a.anchor, b.anchor)
  );
}

/** The first selector with a visible match, as an element: hidden kept-alive panes have no box. */
export function findGuideAnchor(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (element.closest("[data-guide-overlay]")) {
        continue;
      }
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        return element;
      }
    }
  }
  return null;
}

function rectOf(element: HTMLElement): GuideRect {
  const box = element.getBoundingClientRect();
  return { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
}

function focusableIn(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input, select, textarea")].filter(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * Where focus goes when the tour closes. Back to the element it left. When that is gone (the
 * onboarding button that ended first-run setup) or was never anywhere (`<body>`), to the desk's main
 * panel, so the keyboard lands on the app and not on the top of the document.
 */
function restoreFocus(previous: Element | null): void {
  const somewhere = previous !== document.body && previous !== document.documentElement;
  if (somewhere && previous instanceof HTMLElement && document.contains(previous)) {
    previous.focus({ preventScroll: true });
    return;
  }
  const panel = document.querySelector<HTMLElement>('[data-testid="app-main-panel"]');
  if (panel) {
    if (!panel.hasAttribute("tabindex")) {
      panel.setAttribute("tabindex", "-1");
    }
    // The panel is a place for focus to stand, not a control: no ring round the whole desk after a
    // keyboard close. Inline, because the global `:focus-visible` rule is unlayered and beats a utility.
    panel.style.outline = "none";
    panel.focus({ preventScroll: true });
  }
}

type OverlayProps = {
  readonly state: GuideOpenState;
  readonly visibleModes: readonly ProductMode[];
};

function GuideOverlay({ state, visibleModes }: OverlayProps) {
  const { productName } = useProductBrand();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [measure, setMeasure] = useState<Measure>(UNMEASURED);
  const offer = state.kind === "offered";
  const index = state.kind === "step" ? state.index : -1;
  const step: GuideStep | null = offer ? null : (GUIDE_STEPS[index] ?? null);
  const total = GUIDE_STEPS.length;

  const context = useMemo(
    () =>
      guideContextFor(visibleModes, (id) => t(`rail.${id}`), listFormatter(getLocale())),
    // The locale is frozen for the life of a mount, and `Shell` remounts on a locale change.
    [visibleModes],
  );
  const title = offer ? t("guide.offer.title") : step ? t(step.titleKey) : "";
  const bodyCopy = step ? step.body(context) : null;
  const body = offer ? t("guide.offer.body", { total }) : bodyCopy ? t(bodyCopy.key, bodyCopy.vars) : "";

  const measureNow = useCallback(() => {
    const card = cardRef.current;
    if (!card) {
      return;
    }
    const anchorElement = step ? findGuideAnchor(step.anchors) : null;
    const next: Measure = {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      cardHeight: card.offsetHeight,
      anchor: anchorElement ? rectOf(anchorElement) : null,
    };
    setMeasure((previous) => (sameMeasure(previous, next) ? previous : next));
  }, [step]);

  // Open: remember where focus was, make the app inert, put focus on the card. Close: undo all three.
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    cardRef.current?.focus({ preventScroll: true });
    return () => {
      root?.removeAttribute("inert");
      restoreFocus(previous);
    };
  }, []);

  // A new step: bring its anchor into view (the rail scrolls on a short window), then measure.
  useLayoutEffect(() => {
    if (step) {
      findGuideAnchor(step.anchors)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    measureNow();
  }, [measureNow, step]);

  // Focus belongs in the card. It cannot land while the card is hidden (before its first measure),
  // and it must come back if the focused control went with the step (Back on step one), so this runs
  // when the card becomes visible and on every step: the keyboard is never left on nothing.
  const focusKey = `${measure.cardHeight > 0 ? "ready" : "hidden"}:${offer ? "offer" : index}`;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card && !focusKey.startsWith("hidden") && !card.contains(document.activeElement)) {
      card.focus({ preventScroll: true });
    }
  }, [focusKey]);

  // The desk behind the card is alive: keep the ring on the anchor through resize, scroll and settling.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          measureNow();
        });
      }
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const timer = window.setInterval(measureNow, REMEASURE_MS);
    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.clearInterval(timer);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [measureNow]);

  // The keyboard. Capture phase and stopped, so nothing else on the page hears a key meant for the tour.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const card = cardRef.current;
      if (!card) {
        return;
      }
      if (swallowsRepeat(event)) {
        // A held key steps nothing: one press is one stop.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const active = document.activeElement;
      const controls = focusableIn(card);
      const current = active instanceof HTMLElement ? controls.indexOf(active) : -1;
      const action = guideKeyAction(event, {
        insideCard: card.contains(active),
        onCardItself: active === card,
        canBack: !offer && index > 0,
      });
      if (action === null) {
        return;
      }
      if (action === "tab" || action === "shift-tab") {
        const backwards = action === "shift-tab";
        if (tabWouldLeave(current, controls.length, backwards, active === card)) {
          event.preventDefault();
          const target = nextFocusIndex(current, controls.length, backwards);
          (target >= 0 ? controls[target] : card)?.focus({ preventScroll: true });
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dispatchGuide({ type: action });
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [index, offer]);

  const viewportWidth = measure.viewportWidth || (typeof window === "undefined" ? 1280 : window.innerWidth);
  const viewportHeight = measure.viewportHeight || (typeof window === "undefined" ? 800 : window.innerHeight);
  const cardWidth = Math.min(CARD_MAX_WIDTH, viewportWidth - GUIDE_MARGIN * 2);
  const preferred: GuidePlacement = step ? step.placement : "center";
  const placed = placeGuideCard({
    anchor: measure.anchor,
    card: { width: cardWidth, height: measure.cardHeight || 220 },
    viewport: { width: viewportWidth, height: viewportHeight },
    preferred,
  });
  // The ring follows the anchor, not the placement: on a phone the card may have to sit over the
  // rail, and the rail is still what it is pointing at. No anchor on screen, no ring.
  const spotlight = isAnchorVisible(measure.anchor, { width: viewportWidth, height: viewportHeight })
    ? measure.anchor
    : null;

  return (
    <div data-guide-overlay data-testid="guide-overlay">
      {/* Swallows every click and touch on the dimmed desk. It does nothing with them: an outside
          click must never advance the tour, and must never close it either. */}
      <div
        aria-hidden="true"
        data-testid="guide-backdrop"
        className="fixed inset-0 z-[98]"
        style={spotlight ? undefined : { background: SCRIM }}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => event.preventDefault()}
      />
      {spotlight ? (
        <div
          aria-hidden="true"
          data-testid="guide-spotlight"
          className="pointer-events-none fixed z-[99]"
          style={{
            left: spotlight.left - RING_PAD,
            top: spotlight.top - RING_PAD,
            width: spotlight.width + RING_PAD * 2,
            height: spotlight.height + RING_PAD * 2,
            borderRadius: 10,
            boxShadow: `0 0 0 2px var(--accent), 0 0 0 100vmax ${SCRIM}`,
            transition:
              "left var(--motion-3) var(--ease-out), top var(--motion-3) var(--ease-out), width var(--motion-3) var(--ease-out), height var(--motion-3) var(--ease-out)",
          }}
        />
      ) : null}
      <GuideCard
        cardRef={cardRef}
        mode={offer ? "offer" : "step"}
        index={Math.max(0, index)}
        total={total}
        stepId={step?.id ?? null}
        title={title}
        body={body}
        productName={productName}
        placement={placed.placement}
        style={{
          left: placed.left,
          top: placed.top,
          width: cardWidth,
          // Not shown until it has been measured once, so it never flashes at 0,0 on the way in.
          visibility: measure.cardHeight === 0 ? "hidden" : "visible",
          transition: "left var(--motion-3) var(--ease-out), top var(--motion-3) var(--ease-out)",
        }}
        onNext={() => dispatchGuide({ type: "next" })}
        onBack={() => dispatchGuide({ type: "back" })}
        onSkip={() => dispatchGuide({ type: "skip" })}
        onClose={() => dispatchGuide({ type: "close" })}
      />
      {/* What a screen reader hears when the step changes with focus still on a button. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="guide-live">
        {offer ? "" : `${t("guide.progress", { current: index + 1, total })}. `}
        {title}. {body}
      </p>
    </div>
  );
}

type TourProps = {
  readonly visibleModes: readonly ProductMode[];
  /** The desk has loaded, so the rail the tour points at is the real one. */
  readonly ready: boolean;
};

/**
 * Subscribes to the store and mounts the overlay while the tour is open. The overlay is a separate
 * component so its focus, inert and listener effects are tied to being open, not to being rendered.
 */
export function GuideTour({ visibleModes, ready }: TourProps) {
  const { state } = useSyncExternalStore(subscribeGuide, getGuideSnapshot, getGuideSnapshot);
  if (!ready || !isGuideOpen(state) || typeof document === "undefined") {
    return null;
  }
  return createPortal(<GuideOverlay state={state} visibleModes={visibleModes} />, document.body);
}
