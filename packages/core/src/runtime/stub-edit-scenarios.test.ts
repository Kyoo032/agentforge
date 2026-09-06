import { describe, expect, it } from "vitest";
import { matchStubEditScenario, STUB_EDIT_SCENARIOS } from "./stub-edit-scenarios";

const IDS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10"] as const;

describe("STUB_EDIT_SCENARIOS", () => {
  it("enumerates S1 through S10 in order", () => {
    expect(STUB_EDIT_SCENARIOS.map((row) => row.id)).toEqual([...IDS]);
  });

  it("matches the scripted Prep prompts", () => {
    expect(matchStubEditScenario("Remove the silences")?.id).toBe("S1");
    expect(matchStubEditScenario("Remove the silences")?.toolKey).toBe("remove_silence");
    expect(matchStubEditScenario("Remove the silences")?.args).toEqual({
      ranges: [
        { startFrame: 300, endFrame: 360 },
        { startFrame: 750, endFrame: 825 },
        { startFrame: 1350, endFrame: 1395 },
      ],
    });
    expect(matchStubEditScenario("Split at the scene changes")?.id).toBe("S2");
    expect(matchStubEditScenario("Split at the scene changes")?.args).toEqual({ frames: [450, 900] });
    expect(matchStubEditScenario("Add captions from this script")?.toolKey).toBe("add_caption");
    expect(matchStubEditScenario("Add captions from this script")?.args).toEqual({ source: "script" });
    expect(matchStubEditScenario("Auto captions")?.toolKey).toBe("transcribe");
    expect(matchStubEditScenario("Make it 9:16 for Reels")?.toolKey).toBe("reframe");
    expect(matchStubEditScenario("Make it 9:16 for Reels")?.args).toMatchObject({ confirm: true, aspect: "9:16" });
    expect(matchStubEditScenario("Add a title 'Summer Sale' top centre, white with black outline")?.args).toEqual({
      text: "Summer Sale",
    });
    expect(matchStubEditScenario("Trim the first 3 seconds")?.args).toEqual({ inFrame: 90 });
    expect(matchStubEditScenario("Move the second clip to the start")?.args).toEqual({ timelineStartFrame: 0 });
    expect(matchStubEditScenario("Undo the last change")?.id).toBe("S10");
    expect(matchStubEditScenario("Undo the last change")?.args).toEqual({ marker: "undo_last" });
  });

  it("matches S9 delete everything without confirm (G-03 guard)", () => {
    const scenario = matchStubEditScenario("Delete everything");
    expect(scenario?.id).toBe("S9");
    expect(scenario?.toolKey).toBe("clear_timeline");
    expect(scenario?.args).toEqual({});
    expect(scenario?.args).not.toHaveProperty("confirm");
  });

  it("returns null when no scenario matches", () => {
    expect(matchStubEditScenario("hello from chat")).toBeNull();
  });
});
