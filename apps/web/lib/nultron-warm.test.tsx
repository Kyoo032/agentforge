import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NultronMascot } from "@/components/nultron/nultron-mascot";
import { clipSpec, loopSpec, NX_MANIFEST } from "@/components/nultron/nx-image-manifest";
import { pictureUrls } from "@/components/nultron/nx-picture";
import {
  forgetWarmed,
  IDLE_FALLBACK_MS,
  IDLE_TIMEOUT_MS,
  warmedUrls,
  warmMascot,
  warmMascotAtIdle,
  whenIdle,
} from "@/components/nultron/nx-warm";
import {
  HERO_NEXT,
  LIVE_TURN_NEXT,
  ONBOARDING_NEXT,
  SETUP_NEXT,
  slotNextStates,
  UPDATE_NEXT,
} from "./mascot-triggers";
import { MASCOT_MODES, MASCOT_STATES, PHASE_POSES, STATE_MOTION } from "./mascot-states";

/**
 * The character loads what a mount point can reach next, and nothing else. It used to fetch all 19 strips
 * (1.31 MB, 20 requests) on every page that mounted a mascot, and none of the stills. These tests hold the
 * plan: which files a state is made of, what each mount point asks for and when, and that nothing is
 * fetched by importing or rendering.
 */

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const imagesDir = join(web, "components", "nultron", "images");
const read = (...parts: string[]) => readFileSync(join(web, ...parts), "utf8").replace(/\r\n/g, "\n");
const bytesOf = (urls: string[]) => urls.reduce((sum, url) => sum + statSync(join(imagesDir, fileOf(url))).size, 0);
/** `imageUrl` returns the bundler's URL; the file is the last two path segments (`clips/wave.webp`). */
const fileOf = (url: string) => url.split("?")[0].split("/").slice(-2).join("/");

class FakeImage {
  static created: FakeImage[] = [];
  src = "";
  decoding = "";
  constructor() {
    FakeImage.created.push(this);
  }
}

beforeEach(() => {
  FakeImage.created = [];
  forgetWarmed();
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("which files draw a state", () => {
  it("is the still alone for a head, whatever the state", () => {
    for (const state of MASCOT_STATES) {
      const urls = pictureUrls(state, "head");
      expect(urls, state).toHaveLength(1);
      expect(fileOf(urls[0]), state).toBe(`head/${state}.webp`);
    }
  });

  it("adds the clip for a once state and the loop for a working state, on the body", () => {
    for (const state of MASCOT_STATES) {
      const files = pictureUrls(state, "full").map(fileOf);
      expect(files[0], state).toBe(`full/${state}.webp`);
      const strips = files.slice(1);
      if (clipSpec(state)) expect(strips, state).toEqual([`clips/${state}.webp`]);
      else if (loopSpec(state)) expect(strips, state).toEqual([`loops/${state}.webp`]);
      else expect(strips, state).toEqual([]);
    }
  });

  it("can ask for the strip only, or the still only", () => {
    expect(pictureUrls("wave", "full", { still: false }).map(fileOf)).toEqual(["clips/wave.webp"]);
    expect(pictureUrls("wave", "full", { sheet: false }).map(fileOf)).toEqual(["full/wave.webp"]);
    expect(pictureUrls("wave", "head", { still: false })).toEqual([]);
  });
});

describe("the warm-up fetches only what it is asked for", () => {
  it("fetches nothing by being imported or by rendering a mascot", () => {
    renderToStaticMarkup(<NultronMascot state="wave" variant="full" next={HERO_NEXT} />);
    expect(FakeImage.created).toEqual([]);
    expect(warmedUrls()).toEqual([]);
  });

  it("fetches each file once, however many mount points ask", () => {
    expect(warmMascot(["wave", "celebrating"], "full")).toBe(4);
    expect(warmMascot(["wave", "celebrating"], "full")).toBe(0);
    expect(warmMascot(["wave"], "full", { still: false })).toBe(0);
    expect(FakeImage.created).toHaveLength(4);
    expect(FakeImage.created.every((image) => image.decoding === "async" && image.src !== "")).toBe(true);
  });

  it("fetches a head's still and never a strip for it", () => {
    expect(warmMascot(LIVE_TURN_NEXT, "head")).toBe(LIVE_TURN_NEXT.length);
    expect(warmedUrls().every((url) => fileOf(url).startsWith("head/"))).toBe(true);
  });

  it("does nothing where there is no Image (a server render)", () => {
    vi.stubGlobal("Image", undefined);
    expect(warmMascot(["wave"], "full")).toBe(0);
  });

  it("costs the Chat hero two stills at idle and two clips on the first touch, not 1.31 MB", () => {
    warmMascot(HERO_NEXT, "full", { sheet: false });
    const stills = bytesOf(warmedUrls());
    expect(warmedUrls().map(fileOf).sort()).toEqual(["full/celebrating.webp", "full/wave.webp"]);
    warmMascot(HERO_NEXT, "full", { still: false });
    const all = bytesOf(warmedUrls());
    expect(warmedUrls().map(fileOf).sort()).toEqual([
      "clips/celebrating.webp",
      "clips/wave.webp",
      "full/celebrating.webp",
      "full/wave.webp",
    ]);
    expect(stills).toBeLessThan(80_000);
    expect(all).toBeLessThan(400_000);
    expect(all).toBeLessThan((NX_MANIFEST.bytes ?? 0) / 4);
  });
});

describe("when a warm-up runs", () => {
  it("waits for an idle callback, with a timeout, and can be cancelled", () => {
    const requestIdleCallback = vi.fn(() => 7);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback, cancelIdleCallback });
    const run = vi.fn();
    const cancel = whenIdle(run);
    expect(requestIdleCallback).toHaveBeenCalledWith(run, { timeout: IDLE_TIMEOUT_MS });
    expect(run).not.toHaveBeenCalled();
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it("falls back to a short timer where the browser has no idle callback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
    const run = vi.fn();
    whenIdle(run);
    vi.advanceTimersByTime(IDLE_FALLBACK_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fetches at idle, and not if it was cancelled first", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    });
    warmMascotAtIdle(["wave"], "head");
    expect(FakeImage.created).toHaveLength(0);
    vi.advanceTimersByTime(IDLE_FALLBACK_MS);
    expect(FakeImage.created).toHaveLength(1);
    const cancel = warmMascotAtIdle(["celebrating"], "head");
    cancel();
    vi.advanceTimersByTime(IDLE_FALLBACK_MS * 2);
    expect(FakeImage.created).toHaveLength(1);
  });
});

describe("what each mount point says it can reach", () => {
  it("lets an empty desk reach its home pose and sleep, and a chip beside a job every pose a phase calls for", () => {
    for (const mode of MASCOT_MODES) {
      const empty = slotNextStates(mode, "empty");
      expect(empty, mode).toHaveLength(new Set(empty).size);
      expect(empty, mode).toContain("sleep");
      const beside = slotNextStates(mode, "beside");
      expect(beside, mode).toHaveLength(new Set(beside).size);
      for (const pose of [...PHASE_POSES, "celebrating", "error"]) {
        expect(beside, `${mode} beside a job can reach ${pose}`).toContain(pose);
      }
    }
    expect(slotNextStates("market", "empty")).toEqual(["charting", "sleep"]);
  });

  it("names only real states, every one of which has the picture it will be asked for", () => {
    const all = [...HERO_NEXT, ...LIVE_TURN_NEXT, ...SETUP_NEXT, ...UPDATE_NEXT, ...ONBOARDING_NEXT];
    for (const state of all) {
      expect(MASCOT_STATES as readonly string[], state).toContain(state);
      expect(pictureUrls(state, "head"), state).toHaveLength(1);
    }
    expect(HERO_NEXT.map((state) => STATE_MOTION[state])).toEqual(["once", "once"]);
  });
});

describe("the mount points ask at the right moment", () => {
  it("warms the hero's clips on the first pointer, touch or focus, and its stills at idle, not on mount", () => {
    const hero = read("components", "chat-hero.tsx");
    expect(hero).toMatch(/warmMascot\(HERO_NEXT, "full", \{ still: false \}\)/);
    for (const event of ["onPointerEnter", "onPointerDown", "onFocus"]) {
      expect(hero, event).toMatch(new RegExp(`${event}=\\{warmClips\\}`));
    }
    expect(hero).toMatch(/<NultronMascot[^>]*next=\{HERO_NEXT\}/);
    expect(hero).not.toMatch(/useEffect\([^)]*warmMascot\(/);
  });

  it("gives the slot, the live turn and the two panels a `next`, so their stills are fetched at idle", () => {
    expect(read("components", "mascot-slot.tsx")).toMatch(/next=\{next\}/);
    expect(read("components", "chat-turn.tsx")).toMatch(/next=\{LIVE_TURN_NEXT\}/);
    expect(read("components", "component-setup.tsx")).toMatch(/next=\{SETUP_NEXT\}/);
    expect(read("components", "app-updates.tsx")).toMatch(/next=\{UPDATE_NEXT\}/);
    expect(read("components", "onboarding-screen.tsx")).toMatch(/next=\{ONBOARDING_NEXT\}/);
  });

  it("no longer fetches every strip when a mascot mounts", () => {
    const rig = read("components", "nultron", "nx-image-rig.tsx");
    expect(rig).not.toMatch(/warmStrips|new Image\(\)|MASCOT_STATES/);
    expect(rig).not.toMatch(/useEffect\(warm/);
  });
});

describe("a strip is mounted only when it can play", () => {
  const html = (props: Parameters<typeof NultronMascot>[0]) => renderToStaticMarkup(<NultronMascot {...props} />);

  it("does not fetch the loop of a body that is not busy, and does when a job runs", () => {
    expect(html({ state: "charting", placement: "empty", size: 72 })).not.toContain("nx-loop");
    expect(html({ state: "charting", placement: "empty", size: 72, busy: true })).not.toContain("nx-loop");
    expect(html({ state: "charting", placement: "beside", size: 96 })).not.toContain("nx-loop");
    expect(html({ state: "charting", placement: "beside", size: 96, busy: true })).toContain('class="nx-loop"');
  });

  it("mounts a clip for a once state on the body, and waits to call the strip ready", () => {
    const wave = html({ state: "wave", size: 96 });
    expect(wave).toContain('class="nx-strip"');
    expect(wave).not.toContain("data-sheet");
    expect(wave).not.toContain("nx-held");
  });
});
