import { describe, expect, it } from "vitest";
import {
  AMBIENT_ATTR,
  AMBIENT_IDLE_MS,
  AMBIENT_INPUT_GRAIN_MS,
  AMBIENT_REASON_ATTR,
  ambientState,
  attachAmbientMotion,
  type AmbientEnv,
} from "./ambient-motion";

type Listener = (event: { target: unknown }) => void;

/** A browser stand-in: a manual clock, one-shot timers, and event registries that can be fired. */
function fakeEnv(options: { focused?: boolean; hidden?: boolean } = {}) {
  let clock = 1_000;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const windowListeners = new Map<string, Set<Listener>>();
  const documentListeners = new Map<string, Set<() => void>>();
  const attributes = new Map<string, string>();
  const stats = { timersSet: 0, focused: options.focused ?? true };

  // Like the browser, a listener is identified by type, function AND capture flag: removing one with
  // the wrong flag removes nothing, which is how a teardown leaks.
  const windowLike = {
    addEventListener(type: string, listener: Listener, options?: { capture?: boolean }) {
      const key = `${type}|${options?.capture ? "capture" : "bubble"}`;
      const set = windowListeners.get(key) ?? new Set();
      set.add(listener);
      windowListeners.set(key, set);
    },
    removeEventListener(type: string, listener: Listener, options?: { capture?: boolean }) {
      windowListeners.get(`${type}|${options?.capture ? "capture" : "bubble"}`)?.delete(listener);
    },
  };
  const documentLike = {
    hidden: options.hidden ?? false,
    addEventListener(type: string, listener: () => void) {
      const set = documentListeners.get(type) ?? new Set();
      set.add(listener);
      documentListeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      documentListeners.get(type)?.delete(listener);
    },
  };

  const env: AmbientEnv = {
    now: () => clock,
    hasFocus: () => stats.focused,
    window: windowLike,
    document: documentLike,
    root: {
      setAttribute: (name, value) => void attributes.set(name, value),
      removeAttribute: (name) => void attributes.delete(name),
    },
    setTimeout: (callback, ms) => {
      const handle = nextHandle++;
      stats.timersSet += 1;
      timers.set(handle, { at: clock + ms, run: callback });
      return handle;
    },
    clearTimeout: (handle) => void timers.delete(handle),
  };

  return {
    env,
    stats,
    attributes,
    timerCount: () => timers.size,
    listenerCount: () => [...windowListeners.values(), ...documentListeners.values()].reduce((n, s) => n + s.size, 0),
    /** Moves the clock and runs every timer that comes due, in order. */
    advance(ms: number) {
      const target = clock + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        clock = Math.max(clock, due[1].at);
        due[1].run();
      }
      clock = target;
    },
    fire(type: string, target: unknown = windowLike) {
      for (const key of [`${type}|capture`, `${type}|bubble`]) {
        for (const listener of [...(windowListeners.get(key) ?? [])]) {
          listener({ target });
        }
      }
    },
    setHidden(hidden: boolean) {
      documentLike.hidden = hidden;
      for (const listener of [...(documentListeners.get("visibilitychange") ?? [])]) {
        listener();
      }
    },
    window: windowLike,
    paused: () => attributes.get(AMBIENT_ATTR) === "paused",
    reason: () => attributes.get(AMBIENT_REASON_ATTR) ?? null,
  };
}

describe("ambientState", () => {
  it("ranks hidden over blurred over idle over active", () => {
    expect(ambientState({ hidden: false, focused: true, idle: false })).toBe("active");
    expect(ambientState({ hidden: false, focused: true, idle: true })).toBe("idle");
    expect(ambientState({ hidden: false, focused: false, idle: true })).toBe("blurred");
    expect(ambientState({ hidden: true, focused: false, idle: true })).toBe("hidden");
    expect(ambientState({ hidden: true, focused: true, idle: false })).toBe("hidden");
  });
});

describe("attachAmbientMotion", () => {
  it("starts active: no attribute, one idle timer, listeners bound", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    expect(page.paused()).toBe(false);
    expect(page.reason()).toBeNull();
    expect(page.timerCount()).toBe(1);
    expect(page.listenerCount()).toBeGreaterThan(0);
  });

  it("pauses as idle after 12 s with no input, and says why", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    page.advance(AMBIENT_IDLE_MS - 1);
    expect(page.paused()).toBe(false);
    page.advance(1);
    expect(page.paused()).toBe(true);
    expect(page.reason()).toBe("idle");
    expect(page.timerCount()).toBe(0);
  });

  it("counts pointer, key, wheel and touch input as activity", () => {
    for (const type of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) {
      const page = fakeEnv();
      attachAmbientMotion(page.env);
      page.advance(AMBIENT_IDLE_MS - 1_000);
      page.fire(type);
      page.advance(AMBIENT_IDLE_MS - 1);
      expect(page.paused(), `${type} should have kept the desk active`).toBe(false);
      page.advance(2_000);
      expect(page.paused(), `${type} should not hold the desk active forever`).toBe(true);
    }
  });

  it("re-arms for the remainder instead of restarting the timer on every input", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    // A second of input every second for 30 s: the desk stays active and no timer was created per event.
    for (let second = 0; second < 30; second += 1) {
      page.advance(1_000);
      page.fire("pointermove");
    }
    expect(page.paused()).toBe(false);
    // One timer at attach, plus at most one re-arm each time it came due (30 s / 12 s = 2 fires).
    expect(page.stats.timersSet).toBeLessThanOrEqual(4);
  });

  it("coalesces an input storm: 1000 moves inside one grain touch nothing", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    const before = page.stats.timersSet;
    for (let i = 0; i < 1_000; i += 1) {
      page.fire("pointermove");
    }
    expect(page.stats.timersSet).toBe(before);
    expect(page.timerCount()).toBe(1);
    expect(AMBIENT_INPUT_GRAIN_MS).toBeGreaterThanOrEqual(250);
  });

  it("wakes at once on input while idle, and pauses again 12 s later", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    page.advance(AMBIENT_IDLE_MS);
    expect(page.paused()).toBe(true);
    page.fire("pointermove");
    expect(page.paused()).toBe(false);
    expect(page.timerCount()).toBe(1);
    page.advance(AMBIENT_IDLE_MS);
    expect(page.reason()).toBe("idle");
  });

  it("pauses as blurred when the window loses focus and resumes on focus", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    page.stats.focused = false;
    page.fire("blur");
    expect(page.paused()).toBe(true);
    expect(page.reason()).toBe("blurred");
    page.stats.focused = true;
    page.fire("focus");
    expect(page.paused()).toBe(false);
  });

  it("ignores a blur while the document still holds focus (focus moved into an iframe)", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    page.fire("blur");
    expect(page.paused()).toBe(false);
  });

  it("starts blurred when the window is not focused at attach time", () => {
    const page = fakeEnv({ focused: false });
    attachAmbientMotion(page.env);
    expect(page.reason()).toBe("blurred");
  });

  it("pauses as hidden, which outranks blurred, and resumes when visible again", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    page.stats.focused = false;
    page.fire("blur");
    page.setHidden(true);
    expect(page.reason()).toBe("hidden");
    page.setHidden(false);
    expect(page.reason()).toBe("blurred");
    page.stats.focused = true;
    page.fire("focus");
    expect(page.paused()).toBe(false);
  });

  it("treats coming back to a visible tab as activity, so the desk is not paused on arrival", () => {
    const page = fakeEnv();
    attachAmbientMotion(page.env);
    page.advance(AMBIENT_IDLE_MS);
    page.setHidden(true);
    page.setHidden(false);
    expect(page.paused()).toBe(false);
  });

  it("tears everything down: listeners, timer and both attributes", () => {
    const page = fakeEnv();
    const detach = attachAmbientMotion(page.env);
    page.advance(AMBIENT_IDLE_MS);
    expect(page.paused()).toBe(true);
    detach();
    expect(page.listenerCount()).toBe(0);
    expect(page.timerCount()).toBe(0);
    expect(page.attributes.size).toBe(0);
  });
});
