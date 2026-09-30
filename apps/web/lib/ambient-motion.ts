/**
 * One switch for whatever may still loop on the desk, kept out of React so a node test can drive it.
 *
 * Since 2026-09-29 decoration does not loop at all (`lib/motion-tokens.test.ts` fails on an `infinite`
 * animation outside the busy allowlist), so this is the second line of defence, not the first. It is not
 * a licence to add a decorative loop: a pause that waits 12 quiet seconds cannot help a desk somebody is
 * using, and that is where an active /chat spent 9 to 11% of the machine before the loops were removed.
 *
 * Why it exists: the Windows shell runs Chromium without the GPU (`app.disableHardwareAcceleration()`),
 * and every infinite CSS loop then costs a full software-composited frame, sixty times a second, on a
 * screen nobody is touching. Measured on an idle /chat: about a tenth of the machine, and any single
 * loop alone saturates the GPU process, so the loops have to stop together or not at all.
 *
 * The state is a plain fact about the person, not about the page:
 *  - `active`  the window is visible and focused and something moved in the last 12 s.
 *  - `idle`    visible and focused, but no pointer, key, wheel or touch input for 12 s.
 *  - `blurred` another window has focus.
 *  - `hidden`  the tab or window is not visible.
 * Anything but `active` writes `data-ambient="paused"` on `<html>`, plus `data-ambient-reason` naming
 * which one. `app/globals.css` reads only those two attributes. Entrance animations are finite and are
 * never listed there: pausing one leaves its element at the invisible first keyframe.
 *
 * Cost: passive window listeners and ONE outstanding timer. An input event only stores a timestamp
 * (and not even that more than once per grain); when the timer comes due it re-arms for whatever is
 * left of the quiet period instead of being reset on every event.
 */

export type AmbientState = "active" | "idle" | "blurred" | "hidden";

/** No input for this long means the desk is idle. */
export const AMBIENT_IDLE_MS = 12_000;
/** Input inside one grain of the last recorded input is not worth a write. */
export const AMBIENT_INPUT_GRAIN_MS = 250;

export const AMBIENT_ATTR = "data-ambient";
export const AMBIENT_REASON_ATTR = "data-ambient-reason";

/** Events that mean a person is using the desk. */
const INPUT_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;

/** Hidden beats blurred beats idle: the strongest reason to stop is the one reported. */
export function ambientState(facts: { hidden: boolean; focused: boolean; idle: boolean }): AmbientState {
  if (facts.hidden) {
    return "hidden";
  }
  if (!facts.focused) {
    return "blurred";
  }
  return facts.idle ? "idle" : "active";
}

type WindowEventTarget = {
  addEventListener(type: string, listener: () => void, options?: { passive?: boolean; capture?: boolean }): void;
  removeEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
};

/** What `attachAmbientMotion` needs from the browser. Tests pass a fake. */
export type AmbientEnv = {
  now(): number;
  /** `document.hasFocus()`: true while focus is anywhere in this page, iframes included. */
  hasFocus(): boolean;
  window: WindowEventTarget;
  document: {
    hidden: boolean;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void };
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
};

export function browserAmbientEnv(): AmbientEnv {
  return {
    now: () => performance.now(),
    hasFocus: () => document.hasFocus(),
    window,
    document,
    root: document.documentElement,
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => window.clearTimeout(handle),
  };
}

/** Wires the switch up and returns the teardown. */
export function attachAmbientMotion(env: AmbientEnv = browserAmbientEnv()): () => void {
  let focused = env.hasFocus();
  let idle = false;
  let lastInput = env.now();
  let timer = 0;
  let applied: AmbientState | null = null;

  const apply = () => {
    const next = ambientState({ hidden: env.document.hidden, focused, idle });
    if (next === applied) {
      return;
    }
    applied = next;
    if (next === "active") {
      env.root.removeAttribute(AMBIENT_ATTR);
      env.root.removeAttribute(AMBIENT_REASON_ATTR);
      return;
    }
    env.root.setAttribute(AMBIENT_ATTR, "paused");
    env.root.setAttribute(AMBIENT_REASON_ATTR, next);
  };

  const arm = (delay: number) => {
    timer = env.setTimeout(onDue, delay);
  };

  function onDue() {
    timer = 0;
    const quiet = env.now() - lastInput;
    if (quiet >= AMBIENT_IDLE_MS) {
      idle = true;
      apply();
      return;
    }
    arm(AMBIENT_IDLE_MS - quiet);
  }

  /** Something the person did: the quiet period starts over. Only leaving `idle` needs a timer. */
  const touch = () => {
    lastInput = env.now();
    if (!idle) {
      return;
    }
    idle = false;
    apply();
    if (!timer) {
      arm(AMBIENT_IDLE_MS);
    }
  };

  const onInput = () => {
    if (!idle && env.now() - lastInput < AMBIENT_INPUT_GRAIN_MS) {
      return;
    }
    touch();
  };

  // Read the truth instead of assuming it from the event: a `blur` also fires when focus moves into an
  // iframe of this same page, and there `document.hasFocus()` is still true.
  const onFocusChange = () => {
    focused = env.hasFocus();
    if (focused) {
      touch();
    }
    apply();
  };

  const onVisibility = () => {
    if (!env.document.hidden) {
      touch();
    }
    apply();
  };

  const listen = { passive: true, capture: true } as const;
  for (const type of INPUT_EVENTS) {
    env.window.addEventListener(type, onInput, listen);
  }
  env.window.addEventListener("blur", onFocusChange);
  env.window.addEventListener("focus", onFocusChange);
  env.document.addEventListener("visibilitychange", onVisibility);

  arm(AMBIENT_IDLE_MS);
  apply();

  return () => {
    for (const type of INPUT_EVENTS) {
      env.window.removeEventListener(type, onInput, { capture: true });
    }
    env.window.removeEventListener("blur", onFocusChange);
    env.window.removeEventListener("focus", onFocusChange);
    env.document.removeEventListener("visibilitychange", onVisibility);
    if (timer) {
      env.clearTimeout(timer);
      timer = 0;
    }
    env.root.removeAttribute(AMBIENT_ATTR);
    env.root.removeAttribute(AMBIENT_REASON_ATTR);
  };
}
