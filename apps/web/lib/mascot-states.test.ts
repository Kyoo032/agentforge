import { describe, expect, it } from "vitest";
import { MASCOT_MODES, MASCOT_STATE_DATA, MASCOT_STATES, mascotStateFor } from "./mascot-states";

describe("mascot states", () => {
  it("gives every state a pose and a catalog label", () => {
    for (const state of MASCOT_STATES) {
      expect(MASCOT_STATE_DATA[state].labelKey).toBe(`common.mascot.${state}`);
      expect(MASCOT_STATE_DATA[state].pose.length).toBeGreaterThan(0);
    }
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
