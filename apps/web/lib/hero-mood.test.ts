import { describe, expect, it } from "vitest";
import { INITIAL_HERO_MOOD, moodState, reduceHeroMood, type HeroMood, type HeroMoodEvent } from "./hero-mood";
import { MASCOT_STATES } from "./mascot-states";

const run = (events: HeroMoodEvent[], from: HeroMood = INITIAL_HERO_MOOD) => events.reduce(reduceHeroMood, from);

describe("hero mascot mood", () => {
  it("rests idle and waves while a pointer is on it", () => {
    expect(moodState(INITIAL_HERO_MOOD)).toBe("idle");
    expect(moodState(run(["enter"]))).toBe("wave");
    expect(moodState(run(["enter", "leave"]))).toBe("idle");
  });

  it("cheers on a tap and settles back", () => {
    expect(moodState(run(["tap"]))).toBe("celebrating");
    expect(moodState(run(["tap", "settle"]))).toBe("idle");
  });

  it("remembers the hover through a cheer, so it settles on the right face", () => {
    const cheering = run(["enter", "tap"]);
    expect(moodState(cheering)).toBe("celebrating");
    expect(moodState(reduceHeroMood(cheering, "settle"))).toBe("wave");
    expect(moodState(run(["enter", "tap", "leave", "settle"]))).toBe("idle");
  });

  it("returns the same object when an event changes nothing", () => {
    expect(reduceHeroMood(INITIAL_HERO_MOOD, "leave")).toBe(INITIAL_HERO_MOOD);
    expect(reduceHeroMood(INITIAL_HERO_MOOD, "settle")).toBe(INITIAL_HERO_MOOD);
    const cheering = run(["tap"]);
    expect(reduceHeroMood(cheering, "tap")).toBe(cheering);
  });

  it("only ever names a state the mascot has", () => {
    for (const events of [[], ["enter"], ["tap"], ["enter", "tap"]] as HeroMoodEvent[][]) {
      expect(MASCOT_STATES).toContain(moodState(run(events)));
    }
  });
});
