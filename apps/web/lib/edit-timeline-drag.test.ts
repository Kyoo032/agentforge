/**
 * Releasing a timeline drag sends one op, even under React StrictMode.
 *
 * The drag used to send its move/trim from inside the `setDrafts` updater. React may call an updater
 * twice (StrictMode does, on purpose, to surface exactly this), so one drag could post the same
 * `move_clip` twice. `finishDrag` reads the draft from the drag itself, gives `setDrafts` a pure
 * updater, and sends the ops outside it. The fake `setDrafts` below runs every updater twice.
 */
import { describe, expect, it, vi } from "vitest";
import { finishDrag, type TimelineDrafts, type TimelineDrag } from "@/components/edit-timeline";

function strictSetDrafts(initial: TimelineDrafts) {
  let state = initial;
  const setDrafts = vi.fn((update: (prev: TimelineDrafts) => TimelineDrafts) => {
    update(state); // StrictMode's discarded first call
    state = update(state);
  });
  return { setDrafts, read: () => state };
}

const BASE: Omit<TimelineDrag, "mode" | "draft"> = {
  clipId: "clip-1",
  startX: 100,
  startFrame: 30,
  inFrame: 12,
  duration: 90,
  trackId: "v1",
};

describe("finishDrag", () => {
  it("sends a move once, however many times React runs the drafts updater", () => {
    const drafts = strictSetDrafts({ "clip-1": { timelineStartFrame: 60 } });
    const onMove = vi.fn();
    const onTrim = vi.fn();
    finishDrag(
      { ...BASE, mode: "move", draft: { timelineStartFrame: 60 } },
      { setDrafts: drafts.setDrafts, onMove, onTrim },
    );
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("clip-1", "v1", 60);
    expect(onTrim).not.toHaveBeenCalled();
    expect(drafts.read()).toEqual({});
  });

  it("sends a trim from the start as one move and one trim", () => {
    const drafts = strictSetDrafts({});
    const onMove = vi.fn();
    const onTrim = vi.fn();
    const draft = { timelineStartFrame: 40, durationFrames: 80, source: { assetId: "a1", inFrame: 22 } };
    finishDrag({ ...BASE, mode: "trim-in", draft }, { setDrafts: drafts.setDrafts, onMove, onTrim });
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith("clip-1", "v1", 40);
    expect(onTrim).toHaveBeenCalledTimes(1);
    expect(onTrim).toHaveBeenCalledWith("clip-1", 22, 80);
  });

  it("sends a trim from the end as one trim with no new in-point", () => {
    const drafts = strictSetDrafts({});
    const onMove = vi.fn();
    const onTrim = vi.fn();
    finishDrag(
      { ...BASE, mode: "trim-out", draft: { durationFrames: 120 } },
      { setDrafts: drafts.setDrafts, onMove, onTrim },
    );
    expect(onMove).not.toHaveBeenCalled();
    expect(onTrim).toHaveBeenCalledTimes(1);
    expect(onTrim).toHaveBeenCalledWith("clip-1", undefined, 120);
  });

  it("sends nothing for a press that never moved, and still clears the clip's draft", () => {
    const drafts = strictSetDrafts({ "clip-1": {}, "clip-2": { timelineStartFrame: 5 } });
    const onMove = vi.fn();
    const onTrim = vi.fn();
    finishDrag({ ...BASE, mode: "move" }, { setDrafts: drafts.setDrafts, onMove, onTrim });
    expect(onMove).not.toHaveBeenCalled();
    expect(onTrim).not.toHaveBeenCalled();
    expect(drafts.read()).toEqual({ "clip-2": { timelineStartFrame: 5 } });
  });

  it("gives setDrafts an updater that leaves the previous drafts untouched", () => {
    const previous: TimelineDrafts = { "clip-1": { timelineStartFrame: 60 }, "clip-2": { durationFrames: 10 } };
    const frozen = structuredClone(previous);
    let next: TimelineDrafts | null = null;
    finishDrag(
      { ...BASE, mode: "move", draft: { timelineStartFrame: 60 } },
      {
        setDrafts: (update) => {
          next = update(previous);
        },
        onMove: () => {},
        onTrim: () => {},
      },
    );
    expect(previous).toEqual(frozen);
    expect(next).toEqual({ "clip-2": { durationFrames: 10 } });
  });
});
