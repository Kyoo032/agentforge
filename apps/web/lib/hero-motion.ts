/**
 * Motion rules for the empty Chat hero, kept out of React so a node test can drive them.
 *
 * Three jobs, all cheap:
 *  - Pointer parallax. One `pointermove` listener on the hero, coalesced to one `requestAnimationFrame`
 *    write of two unitless custom properties (`--px`, `--py`, each -1..1). The CSS turns them into
 *    `transform` offsets, so nothing lays out or repaints. The hero's rect is read once per burst of
 *    movement, before the write, never per event.
 *  - Pause. Whatever still moves inside the hero (the shapes no longer loop; that is the mascot) stops
 *    while the hero is scrolled out of view or the tab is hidden (`data-paused="true"`, read by
 *    `.chat-hero[data-paused]` in globals.css).
 *  - Gate. Nothing binds under `prefers-reduced-motion: reduce`, and pointer movement only counts on
 *    a fine, hover-capable pointer. A phone keeps tap reactions and drops the parallax.
 */

export type HeroMotionMode = "off" | "tap" | "full";

export function heroMotionMode(input: { reduced: boolean; finePointer: boolean }): HeroMotionMode {
  if (input.reduced) {
    return "off";
  }
  return input.finePointer ? "full" : "tap";
}

type Rect = { left: number; top: number; width: number; height: number };

const clampUnit = (value: number) => Math.max(-1, Math.min(1, value));

/** Where a point sits inside `rect`, as -1 (left/top edge) .. 1 (right/bottom edge). */
export function pointerToUnit(x: number, y: number, rect: Rect): { x: number; y: number } {
  const nx = rect.width > 0 ? ((x - rect.left) / rect.width) * 2 - 1 : 0;
  const ny = rect.height > 0 ? ((y - rect.top) / rect.height) * 2 - 1 : 0;
  return { x: clampUnit(nx), y: clampUnit(ny) };
}

type MediaQueryLike = {
  matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
};

type ObserverLike = { observe(target: unknown): void; disconnect(): void };

/** What `attachHeroMotion` needs from the browser. Tests pass a fake. */
export type HeroMotionEnv = {
  matchMedia(query: string): MediaQueryLike;
  createObserver?: (onChange: (inView: boolean) => void) => ObserverLike;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
  now(): number;
  document: {
    hidden: boolean;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
};

export type HeroTarget = {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): Rect;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
/** A measured rect is trusted this long while the pointer keeps moving (the pane can scroll). */
const RECT_TTL_MS = 250;

export function browserHeroEnv(): HeroMotionEnv {
  return {
    matchMedia: (query) => window.matchMedia(query),
    createObserver:
      typeof IntersectionObserver === "function"
        ? (onChange) =>
            new IntersectionObserver((entries) => {
              const latest = entries[entries.length - 1];
              if (latest) {
                onChange(latest.isIntersecting);
              }
            })
        : undefined,
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now(),
    document,
  };
}

/** Wires the hero up and returns the teardown. */
export function attachHeroMotion(hero: HeroTarget, env: HeroMotionEnv = browserHeroEnv()): () => void {
  const reduced = env.matchMedia(REDUCED_MOTION_QUERY);
  const fine = env.matchMedia(FINE_POINTER_QUERY);

  let inView = true;
  let frame = 0;
  let pending: { x: number; y: number } | null = null;
  let rect: Rect | null = null;
  let rectAt = 0;
  let unbindPointer: (() => void) | null = null;

  const syncPaused = () => {
    if (!inView || env.document.hidden) {
      hero.setAttribute("data-paused", "true");
    } else {
      hero.removeAttribute("data-paused");
    }
  };

  const write = (x: number, y: number) => {
    hero.style.setProperty("--px", x.toFixed(3));
    hero.style.setProperty("--py", y.toFixed(3));
  };

  const flush = () => {
    frame = 0;
    if (!pending) {
      return;
    }
    const point = pending;
    pending = null;
    const at = env.now();
    if (!rect || at - rectAt > RECT_TTL_MS) {
      rect = hero.getBoundingClientRect();
      rectAt = at;
    }
    const unit = pointerToUnit(point.x, point.y, rect);
    write(unit.x, unit.y);
  };

  const onMove = (event: Event) => {
    const { clientX, clientY, pointerType } = event as PointerEvent;
    if (pointerType === "touch") {
      return;
    }
    pending = { x: clientX, y: clientY };
    if (!frame) {
      frame = env.requestAnimationFrame(flush);
    }
  };

  const onLeave = () => {
    pending = null;
    rect = null;
    if (frame) {
      env.cancelAnimationFrame(frame);
      frame = 0;
    }
    write(0, 0);
  };

  const bindPointer = () => {
    if (unbindPointer) {
      return;
    }
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);
    unbindPointer = () => {
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      onLeave();
      hero.style.removeProperty("--px");
      hero.style.removeProperty("--py");
      unbindPointer = null;
    };
  };

  const applyMode = () => {
    const mode = heroMotionMode({ reduced: reduced.matches, finePointer: fine.matches });
    if (mode === "full") {
      bindPointer();
    } else {
      unbindPointer?.();
    }
  };

  const onVisibility = () => syncPaused();

  const observer = env.createObserver?.((visible) => {
    inView = visible;
    syncPaused();
  });
  observer?.observe(hero);

  applyMode();
  syncPaused();
  reduced.addEventListener("change", applyMode);
  fine.addEventListener("change", applyMode);
  env.document.addEventListener("visibilitychange", onVisibility);

  return () => {
    reduced.removeEventListener("change", applyMode);
    fine.removeEventListener("change", applyMode);
    env.document.removeEventListener("visibilitychange", onVisibility);
    observer?.disconnect();
    unbindPointer?.();
    hero.removeAttribute("data-paused");
  };
}

/** A computed custom property such as `--motion-wiggle`, or `fallback` when it is unset. */
export function cssToken(element: Element, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

export function parseMs(value: string, fallback: number): number {
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(value.trim());
  if (!match) {
    return fallback;
  }
  const amount = Number(match[1]);
  return match[2] === "s" ? amount * 1000 : amount;
}

/**
 * The tap response of a decorative shape: one scale pop on the compositor. It returns false, and
 * does nothing, for a reader who asked for reduced motion or a runtime without `Element.animate`.
 * Only `scale` moves, so the poke composes with the arrival's `rotate` / `translate` and with the
 * pointer drift's `transform` instead of fighting either.
 */
export function pokeShape(shape: Element, reducedMotion: boolean): boolean {
  if (reducedMotion || typeof shape.animate !== "function") {
    return false;
  }
  shape.animate([{ scale: 1 }, { scale: 1.7 }, { scale: 1 }], {
    duration: parseMs(cssToken(shape, "--motion-wiggle", "560ms"), 560),
    easing: cssToken(shape, "--ease-spring", "linear"),
  });
  return true;
}
