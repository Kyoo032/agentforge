import { describe, expect, it } from "vitest";
import {
  attachHeroMotion,
  heroMotionMode,
  type HeroMotionEnv,
  type HeroTarget,
  parseMs,
  pointerToUnit,
  pokeShape,
} from "./hero-motion";

/**
 * The hero's motion rules run against a fake element and a fake browser, because the environment
 * is node. What is asserted is what the page does with them: which listeners exist, how often a
 * burst of pointer movement writes, and when the loops are told to stop. The live drive is in
 * `.cursor/skills/verify-agentforge/features/chat.md`, "Hero".
 */

type Listener = (event: Event) => void;

function fakeHero(rect = { left: 100, top: 50, width: 200, height: 100 }) {
  const listeners = new Map<string, Listener>();
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  let rectReads = 0;
  const hero: HeroTarget = {
    style: {
      setProperty: (name, value) => void properties.set(name, value),
      removeProperty: (name) => void properties.delete(name),
    },
    setAttribute: (name, value) => void attributes.set(name, value),
    removeAttribute: (name) => void attributes.delete(name),
    getBoundingClientRect: () => {
      rectReads += 1;
      return rect;
    },
    addEventListener: (type, listener) => void listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    },
  };
  const move = (clientX: number, clientY: number, pointerType = "mouse") =>
    (listeners.get("pointermove") as ((e: object) => void) | undefined)?.({ clientX, clientY, pointerType });
  return { hero, listeners, attributes, properties, move, rectReads: () => rectReads };
}

type Query = { matches: boolean; fire: () => void };

function fakeEnv(options: { reduced?: boolean; fine?: boolean; hidden?: boolean; observer?: boolean } = {}) {
  const queries = new Map<string, Query & { handlers: Set<() => void> }>();
  const query = (text: string, matches: boolean) => {
    const handlers = new Set<() => void>();
    const entry = {
      matches,
      handlers,
      fire: () => {
        for (const handler of handlers) {
          handler();
        }
      },
    };
    queries.set(text, entry);
    return entry;
  };
  const reduced = query("(prefers-reduced-motion: reduce)", options.reduced ?? false);
  const fine = query("(hover: hover) and (pointer: fine)", options.fine ?? true);

  const frames: (() => void)[] = [];
  let cancelled = 0;
  let visibility: (() => void) | null = null;
  let observerCallback: ((inView: boolean) => void) | null = null;
  let observed = 0;
  let disconnected = 0;
  let clock = 0;

  const doc = {
    hidden: options.hidden ?? false,
    addEventListener: (_type: "visibilitychange", listener: () => void) => {
      visibility = listener;
    },
    removeEventListener: (_type: "visibilitychange", listener: () => void) => {
      if (visibility === listener) {
        visibility = null;
      }
    },
  };

  const env: HeroMotionEnv = {
    matchMedia: (text) => {
      const entry = queries.get(text);
      if (!entry) {
        throw new Error(`unexpected media query ${text}`);
      }
      return {
        get matches() {
          return entry.matches;
        },
        addEventListener: (_type, listener) => void entry.handlers.add(listener),
        removeEventListener: (_type, listener) => void entry.handlers.delete(listener),
      };
    },
    createObserver:
      options.observer === false
        ? undefined
        : (onChange) => {
            observerCallback = onChange;
            return {
              observe: () => {
                observed += 1;
              },
              disconnect: () => {
                disconnected += 1;
              },
            };
          },
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame: () => {
      cancelled += 1;
    },
    now: () => clock,
    document: doc,
  };

  return {
    env,
    reduced,
    fine,
    doc,
    frames: () => frames.length,
    runFrame: () => frames.shift()?.(),
    cancelled: () => cancelled,
    setNow: (value: number) => {
      clock = value;
    },
    visibilityChange: () => visibility?.(),
    hasVisibilityListener: () => visibility !== null,
    intersect: (inView: boolean) => observerCallback?.(inView),
    observed: () => observed,
    disconnected: () => disconnected,
  };
}

describe("heroMotionMode", () => {
  it("is off under reduced motion, whatever the pointer", () => {
    expect(heroMotionMode({ reduced: true, finePointer: true })).toBe("off");
    expect(heroMotionMode({ reduced: true, finePointer: false })).toBe("off");
  });

  it("keeps only tap reactions on a coarse pointer", () => {
    expect(heroMotionMode({ reduced: false, finePointer: false })).toBe("tap");
    expect(heroMotionMode({ reduced: false, finePointer: true })).toBe("full");
  });
});

describe("pointerToUnit", () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 };

  it("maps the centre to 0 and the edges to -1 and 1", () => {
    expect(pointerToUnit(200, 100, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerToUnit(100, 50, rect)).toEqual({ x: -1, y: -1 });
    expect(pointerToUnit(300, 150, rect)).toEqual({ x: 1, y: 1 });
  });

  it("clamps a point outside the rect and survives an empty one", () => {
    expect(pointerToUnit(900, -900, rect)).toEqual({ x: 1, y: -1 });
    expect(pointerToUnit(5, 5, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("attachHeroMotion: binding", () => {
  it("binds pointer movement on a fine pointer", () => {
    const { hero, listeners } = fakeHero();
    attachHeroMotion(hero, fakeEnv().env);
    expect([...listeners.keys()].sort()).toEqual(["pointerleave", "pointermove"]);
  });

  it("binds nothing under reduced motion", () => {
    const { hero, listeners, properties } = fakeHero();
    const sim = fakeEnv({ reduced: true });
    attachHeroMotion(hero, sim.env);
    expect(listeners.size).toBe(0);
    expect(properties.size).toBe(0);
  });

  it("binds nothing on a coarse pointer", () => {
    const { hero, listeners } = fakeHero();
    attachHeroMotion(hero, fakeEnv({ fine: false }).env);
    expect(listeners.size).toBe(0);
  });

  it("follows the preference when it changes while mounted", () => {
    const { hero, listeners, properties, move } = fakeHero();
    const sim = fakeEnv();
    attachHeroMotion(hero, sim.env);
    move(300, 150);
    sim.runFrame();
    expect(properties.get("--px")).toBe("1.000");

    sim.reduced.matches = true;
    sim.reduced.fire();
    expect(listeners.size).toBe(0);
    expect(properties.has("--px")).toBe(false);

    sim.reduced.matches = false;
    sim.reduced.fire();
    expect(listeners.has("pointermove")).toBe(true);
  });
});

describe("attachHeroMotion: parallax writes", () => {
  it("coalesces a burst of moves into one frame and one write of the latest point", () => {
    const { hero, properties, move } = fakeHero();
    const sim = fakeEnv();
    attachHeroMotion(hero, sim.env);
    for (let i = 0; i < 40; i += 1) {
      move(100 + i, 100);
    }
    expect(sim.frames()).toBe(1);
    sim.runFrame();
    expect(properties.get("--px")).toBe((((139 - 100) / 200) * 2 - 1).toFixed(3));
    expect(properties.get("--py")).toBe("0.000");
    expect(sim.frames()).toBe(0);
  });

  it("reads the rect once per burst, not once per event", () => {
    const { hero, move, rectReads } = fakeHero();
    const sim = fakeEnv();
    attachHeroMotion(hero, sim.env);
    for (let frame = 0; frame < 5; frame += 1) {
      sim.setNow(frame * 16);
      move(150, 80);
      sim.runFrame();
    }
    expect(rectReads()).toBe(1);
    sim.setNow(1000);
    move(150, 80);
    sim.runFrame();
    expect(rectReads()).toBe(2);
  });

  it("ignores touch pointers", () => {
    const { hero, move, properties } = fakeHero();
    const sim = fakeEnv();
    attachHeroMotion(hero, sim.env);
    move(200, 100, "touch");
    expect(sim.frames()).toBe(0);
    expect(properties.size).toBe(0);
  });

  it("rests the shapes when the pointer leaves, and drops a queued frame", () => {
    const { hero, listeners, properties, move } = fakeHero();
    const sim = fakeEnv();
    attachHeroMotion(hero, sim.env);
    move(300, 150);
    sim.runFrame();
    move(120, 60);
    (listeners.get("pointerleave") as () => void)();
    expect(sim.cancelled()).toBe(1);
    expect(properties.get("--px")).toBe("0.000");
    expect(properties.get("--py")).toBe("0.000");
  });
});

describe("attachHeroMotion: pausing", () => {
  it("pauses while the hero is scrolled out of view and resumes when it returns", () => {
    const { hero, attributes } = fakeHero();
    const sim = fakeEnv();
    attachHeroMotion(hero, sim.env);
    expect(sim.observed()).toBe(1);
    expect(attributes.has("data-paused")).toBe(false);

    sim.intersect(false);
    expect(attributes.get("data-paused")).toBe("true");
    sim.intersect(true);
    expect(attributes.has("data-paused")).toBe(false);
  });

  it("pauses in a hidden tab and resumes when it is shown", () => {
    const { hero, attributes } = fakeHero();
    const sim = fakeEnv({ hidden: true });
    attachHeroMotion(hero, sim.env);
    expect(attributes.get("data-paused")).toBe("true");

    sim.doc.hidden = false;
    sim.visibilityChange();
    expect(attributes.has("data-paused")).toBe(false);

    sim.doc.hidden = true;
    sim.visibilityChange();
    expect(attributes.get("data-paused")).toBe("true");
  });

  it("stays paused while either reason holds", () => {
    const { hero, attributes } = fakeHero();
    const sim = fakeEnv();
    attachHeroMotion(hero, sim.env);
    sim.intersect(false);
    sim.doc.hidden = true;
    sim.visibilityChange();
    sim.intersect(true);
    expect(attributes.get("data-paused")).toBe("true");
    sim.doc.hidden = false;
    sim.visibilityChange();
    expect(attributes.has("data-paused")).toBe(false);
  });

  it("works without IntersectionObserver", () => {
    const { hero, attributes } = fakeHero();
    attachHeroMotion(hero, fakeEnv({ observer: false }).env);
    expect(attributes.has("data-paused")).toBe(false);
  });
});

describe("attachHeroMotion: teardown", () => {
  it("removes every listener, observer and attribute it added", () => {
    const { hero, listeners, attributes, properties, move } = fakeHero();
    const sim = fakeEnv();
    const detach = attachHeroMotion(hero, sim.env);
    move(300, 150);
    sim.intersect(false);
    detach();

    expect(listeners.size).toBe(0);
    expect(attributes.size).toBe(0);
    expect(properties.size).toBe(0);
    expect(sim.disconnected()).toBe(1);
    expect(sim.hasVisibilityListener()).toBe(false);
    expect(sim.reduced.handlers.size).toBe(0);
    expect(sim.fine.handlers.size).toBe(0);
  });
});

describe("parseMs and pokeShape", () => {
  it("reads a token's milliseconds or seconds and falls back on anything else", () => {
    expect(parseMs("560ms", 1)).toBe(560);
    expect(parseMs(" 1.5s ", 1)).toBe(1500);
    expect(parseMs("", 7)).toBe(7);
    expect(parseMs("calc(1 * 2ms)", 7)).toBe(7);
  });

  it("does nothing for a reader who asked for reduced motion", () => {
    let called = 0;
    const shape = {
      animate: () => {
        called += 1;
      },
    } as unknown as Element;
    expect(pokeShape(shape, true)).toBe(false);
    expect(called).toBe(0);
  });

  it("does nothing where Element.animate does not exist", () => {
    expect(pokeShape({} as unknown as Element, false)).toBe(false);
  });
});
