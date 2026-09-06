import { describe, expect, it } from "vitest";
import { emptyProject, type Clip } from "@agentforge/core/edit";
import { applyOwnerOps, clearBadgesOnHumanTouch } from "./edit-badges";

function clip(partial: Partial<Clip> & Pick<Clip, "id">): Clip {
  return {
    trackId: "v1",
    timelineStartFrame: 0,
    durationFrames: 90,
    status: "ready",
    ...partial,
  };
}

describe("edit badges (G-06)", () => {
  it("clears a clip badge on human touch", () => {
    const doc = emptyProject({
      id: "p1",
      workspaceId: "w1",
      name: "Loop",
      aspect: "16:9",
    });
    doc.clips = [clip({ id: "c1", badge: { cardId: "card-1" } })];
    const next = clearBadgesOnHumanTouch(doc, ["c1"]);
    expect(next.clips[0]?.badge).toBeUndefined();
    expect(doc.clips[0]?.badge).toEqual({ cardId: "card-1" });
  });

  it("clears badges when folding owner trim / move / split / delete", () => {
    const doc = emptyProject({
      id: "p1",
      workspaceId: "w1",
      name: "Loop",
      aspect: "16:9",
    });
    doc.clips = [
      clip({ id: "c1", timelineStartFrame: 0, durationFrames: 120, badge: { cardId: "card-1" } }),
      clip({ id: "c2", timelineStartFrame: 200, durationFrames: 30, badge: { cardId: "card-2" } }),
    ];

    const trimmed = applyOwnerOps(doc, [{ type: "trim_clip", payload: { clipId: "c1", durationFrames: 60 } }]);
    expect(trimmed.clips.find((item) => item.id === "c1")?.badge).toBeUndefined();
    expect(trimmed.clips.find((item) => item.id === "c1")?.durationFrames).toBe(60);
    expect(trimmed.clips.find((item) => item.id === "c2")?.badge).toEqual({ cardId: "card-2" });

    const moved = applyOwnerOps(doc, [{ type: "move_clip", payload: { clipId: "c1", trackId: "v1", timelineStartFrame: 10 } }]);
    expect(moved.clips.find((item) => item.id === "c1")?.badge).toBeUndefined();
    expect(moved.clips.find((item) => item.id === "c1")?.timelineStartFrame).toBe(10);

    const split = applyOwnerOps(doc, [{ type: "split_clip", payload: { clipId: "c1", atFrame: 40, newClipId: "c1b" } }]);
    expect(split.clips.find((item) => item.id === "c1")?.badge).toBeUndefined();
    expect(split.clips.find((item) => item.id === "c1b")?.badge).toBeUndefined();

    const deleted = applyOwnerOps(doc, [{ type: "delete_clip", payload: { clipId: "c1" } }]);
    expect(deleted.clips.some((item) => item.id === "c1")).toBe(false);
    expect(deleted.clips.find((item) => item.id === "c2")?.badge).toEqual({ cardId: "card-2" });
  });
});
