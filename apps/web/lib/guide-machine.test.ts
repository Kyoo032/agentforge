import { describe, expect, it } from "vitest";
import {
  GUIDE_IDLE,
  guideReducer,
  isGuideOpen,
  outcomeOwed,
  type GuideEvent,
  type GuideState,
} from "./guide-machine";

const STEPS = 5;
const EVENTS: GuideEvent["type"][] = ["offer", "start", "next", "back", "skip", "close", "replay"];

function run(events: GuideEvent["type"][], from: GuideState = GUIDE_IDLE, count = STEPS): GuideState {
  return events.reduce<GuideState>((state, type) => guideReducer(state, { type }, count), from);
}

describe("the guide state machine", () => {
  it("starts idle and is offered once", () => {
    expect(GUIDE_IDLE).toEqual({ kind: "idle" });
    expect(run(["offer"])).toEqual({ kind: "offered" });
    // A second offer while it is already on screen changes nothing.
    const offered = run(["offer"]);
    expect(guideReducer(offered, { type: "offer" }, STEPS)).toBe(offered);
  });

  it("walks offered -> step 0 -> ... -> the last step -> done(finished)", () => {
    expect(run(["offer", "start"])).toEqual({ kind: "step", index: 0 });
    expect(run(["offer", "start", "next", "next"])).toEqual({ kind: "step", index: 2 });
    expect(run(["offer", "start", "next", "next", "next", "next"])).toEqual({ kind: "step", index: 4 });
    expect(run(["offer", "start", "next", "next", "next", "next", "next"])).toEqual({
      kind: "done",
      outcome: "finished",
    });
  });

  it("treats Next on the offer as starting the tour", () => {
    expect(run(["offer", "next"])).toEqual({ kind: "step", index: 0 });
  });

  it("goes back a step, but never before the first and never from the offer", () => {
    expect(run(["offer", "start", "next", "next", "back"])).toEqual({ kind: "step", index: 1 });
    expect(run(["offer", "start", "back"])).toEqual({ kind: "step", index: 0 });
    expect(run(["offer", "back"])).toEqual({ kind: "offered" });
    expect(run(["back"])).toEqual({ kind: "idle" });
  });

  it("ends as skipped on Skip, from the offer and from any step", () => {
    expect(run(["offer", "skip"])).toEqual({ kind: "done", outcome: "skipped" });
    expect(run(["offer", "start", "next", "skip"])).toEqual({ kind: "done", outcome: "skipped" });
  });

  it("ends as closed on close (the button and Escape), from the offer and from any step", () => {
    expect(run(["offer", "close"])).toEqual({ kind: "done", outcome: "closed" });
    expect(run(["offer", "start", "next", "next", "close"])).toEqual({ kind: "done", outcome: "closed" });
  });

  it("does not end a tour that is not open: Skip and close on idle or done are nothing", () => {
    expect(run(["skip"])).toEqual({ kind: "idle" });
    expect(run(["close"])).toEqual({ kind: "idle" });
    const done = run(["offer", "skip"]);
    expect(guideReducer(done, { type: "close" }, STEPS)).toBe(done);
    expect(guideReducer(done, { type: "skip" }, STEPS)).toBe(done);
    expect(guideReducer(done, { type: "next" }, STEPS)).toBe(done);
    expect(guideReducer(done, { type: "back" }, STEPS)).toBe(done);
  });

  it("is not re-offered once it is done in this session", () => {
    const done = run(["offer", "close"]);
    expect(guideReducer(done, { type: "offer" }, STEPS)).toBe(done);
  });

  it("replays from anywhere, straight to the first step", () => {
    expect(run(["replay"])).toEqual({ kind: "step", index: 0 });
    expect(run(["offer", "skip", "replay"])).toEqual({ kind: "step", index: 0 });
    expect(run(["offer", "start", "next", "next", "replay"])).toEqual({ kind: "step", index: 0 });
    expect(run(["offer", "replay"])).toEqual({ kind: "step", index: 0 });
  });

  it("finishes a replay as finished and can be replayed again", () => {
    const finished = run(["replay", "next", "next", "next", "next", "next"]);
    expect(finished).toEqual({ kind: "done", outcome: "finished" });
    expect(run(["replay"], finished)).toEqual({ kind: "step", index: 0 });
  });

  it("with no steps at all offers nothing and replays nothing, rather than opening an empty card", () => {
    expect(run(["offer"], GUIDE_IDLE, 0)).toEqual({ kind: "idle" });
    expect(run(["replay"], GUIDE_IDLE, 0)).toEqual({ kind: "idle" });
  });

  it("with one step, Next ends it", () => {
    expect(run(["replay", "next"], GUIDE_IDLE, 1)).toEqual({ kind: "done", outcome: "finished" });
  });

  it("only reports an outcome when an open tour ends", () => {
    const offered: GuideState = { kind: "offered" };
    const step: GuideState = { kind: "step", index: 2 };
    expect(outcomeOwed(offered, { kind: "done", outcome: "skipped" })).toBe("skipped");
    expect(outcomeOwed(step, { kind: "done", outcome: "closed" })).toBe("closed");
    expect(outcomeOwed({ kind: "step", index: 4 }, { kind: "done", outcome: "finished" })).toBe("finished");
    expect(outcomeOwed(GUIDE_IDLE, offered)).toBeNull();
    expect(outcomeOwed(offered, step)).toBeNull();
    expect(outcomeOwed({ kind: "done", outcome: "closed" }, { kind: "done", outcome: "closed" })).toBeNull();
  });

  it("isGuideOpen is true only for the offer and the steps", () => {
    expect(isGuideOpen(GUIDE_IDLE)).toBe(false);
    expect(isGuideOpen({ kind: "offered" })).toBe(true);
    expect(isGuideOpen({ kind: "step", index: 0 })).toBe(true);
    expect(isGuideOpen({ kind: "done", outcome: "finished" })).toBe(false);
  });

  it("never leaves the state space: every sequence of up to 5 events stays valid", () => {
    function valid(state: GuideState): boolean {
      switch (state.kind) {
        case "idle":
        case "offered":
          return true;
        case "step":
          return Number.isInteger(state.index) && state.index >= 0 && state.index < STEPS;
        case "done":
          return ["finished", "skipped", "closed"].includes(state.outcome);
      }
    }
    let visited = 0;
    function walk(state: GuideState, depth: number): void {
      expect(valid(state)).toBe(true);
      visited += 1;
      if (depth === 0) {
        return;
      }
      for (const type of EVENTS) {
        walk(guideReducer(state, { type }, STEPS), depth - 1);
      }
    }
    walk(GUIDE_IDLE, 5);
    expect(visited).toBeGreaterThan(1000);
  });

  it("does not mutate the state it is given", () => {
    const state: GuideState = Object.freeze({ kind: "step", index: 1 });
    expect(() => guideReducer(state, { type: "next" }, STEPS)).not.toThrow();
    expect(state).toEqual({ kind: "step", index: 1 });
  });
});
