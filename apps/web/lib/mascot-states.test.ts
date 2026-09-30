import { describe, expect, it } from "vitest";
import {
  isMascotBusy,
  MASCOT_MODES,
  MASCOT_STATES,
  mascotLabelKey,
  mascotStateFor,
  STATE_MOTION,
} from "./mascot-states";

describe("mascot states", () => {
  it("has the 17 states the desk shipped plus the four Nultron ones", () => {
    expect(MASCOT_STATES).toHaveLength(21);
    for (const added of ["surprised", "love", "charging", "lets-go"]) {
      expect(MASCOT_STATES).toContain(added);
    }
  });

  it("gives every state a motion and a catalog label", () => {
    expect(Object.keys(STATE_MOTION).sort()).toEqual([...MASCOT_STATES].sort());
    for (const state of MASCOT_STATES) {
      expect(mascotLabelKey(state)).toBe(`common.mascot.${state}`);
      expect(["still", "once", "loop-busy"], state).toContain(STATE_MOTION[state]);
    }
  });

  it("splits motion the way the perf budget needs: still, once, or loop only while busy", () => {
    const by = (motion: string) => MASCOT_STATES.filter((state) => STATE_MOTION[state] === motion);
    expect(by("still")).toEqual(["idle", "sleep"]);
    expect(by("once").sort()).toEqual(["celebrating", "error", "lets-go", "love", "surprised", "wave"]);
    expect(by("loop-busy")).toEqual([
      "thinking",
      "writing",
      "answering",
      "searching",
      "calculating",
      "charting",
      "reviewing",
      "listening",
      "painting",
      "filming",
      "editing",
      "presenting",
      "charging",
    ]);
  });

  it("maps job phases onto the activity they describe", () => {
    expect(mascotStateFor({ mode: "research", placement: "beside", busy: true, phase: "searching" })).toBe("searching");
    expect(mascotStateFor({ mode: "research", placement: "beside", busy: true, phase: "reading" })).toBe("searching");
    expect(mascotStateFor({ mode: "research", placement: "beside", busy: true, phase: "drafting" })).toBe("writing");
    expect(mascotStateFor({ mode: "finance", placement: "beside", busy: true, phase: "computing" })).toBe(
      "calculating",
    );
    expect(mascotStateFor({ mode: "data", placement: "beside", busy: true, phase: "analyzing" })).toBe("calculating");
    expect(mascotStateFor({ mode: "knowledge", placement: "beside", busy: true, phase: "indexing" })).toBe("searching");
    expect(mascotStateFor({ mode: "meeting", placement: "beside", busy: true, phase: "transcribing" })).toBe(
      "listening",
    );
    expect(mascotStateFor({ mode: "market", placement: "beside", busy: true, phase: "analysts" })).toBe("charting");
    expect(mascotStateFor({ mode: "legal", placement: "beside", busy: true, phase: "verifying" })).toBe("reviewing");
  });

  it("uses the mode's home pose when the phase is unknown or absent", () => {
    expect(mascotStateFor({ mode: "documents", placement: "empty" })).toBe("writing");
    expect(mascotStateFor({ mode: "images", placement: "beside", busy: true })).toBe("painting");
    expect(mascotStateFor({ mode: "videos", placement: "beside", busy: true })).toBe("filming");
    expect(mascotStateFor({ mode: "edit", placement: "empty" })).toBe("editing");
    expect(mascotStateFor({ mode: "presentations", placement: "empty" })).toBe("presenting");
    expect(mascotStateFor({ mode: "education", placement: "empty" })).toBe("presenting");
    expect(mascotStateFor({ mode: "music", placement: "beside", busy: true, phase: "not-a-phase" })).toBe("listening");
  });

  it("celebrates a finished job and looks unsure when one fails", () => {
    expect(mascotStateFor({ mode: "finance", placement: "beside", done: true, phase: "saving" })).toBe("celebrating");
    expect(mascotStateFor({ mode: "research", placement: "beside", failed: true, busy: true })).toBe("error");
  });

  it("covers every job mode the desk ships", () => {
    expect(MASCOT_MODES).toEqual([
      "chat",
      "documents",
      "research",
      "finance",
      "data",
      "market",
      "legal",
      "meeting",
      "images",
      "videos",
      "music",
      "edit",
      "presentations",
      "education",
      "knowledge",
    ]);
  });
});

describe("isMascotBusy", () => {
  it("is true only for a working pose next to a running job", () => {
    for (const state of ["thinking", "writing", "answering", "searching", "calculating", "charting", "charging"] as const) {
      expect(isMascotBusy(state, "beside"), state).toBe(true);
    }
  });

  it("is false for a resting or finished pose, wherever it sits", () => {
    for (const state of ["idle", "wave", "sleep", "celebrating", "error", "surprised", "love", "lets-go"] as const) {
      expect(isMascotBusy(state, "beside"), state).toBe(false);
    }
  });

  it("is false on an empty desk, where a working pose is decoration and not a status", () => {
    for (const state of MASCOT_STATES) {
      expect(isMascotBusy(state, "empty"), state).toBe(false);
    }
  });
});
