import { describe, expect, it } from "vitest";
import { matchStubEditScenario } from "../runtime/stub-edit-scenarios";
import { matchStubFillScenario, matchStubGenerateScenario } from "../runtime/stub-edit-fill";
import {
  assetFramesToTimeline,
  extractMadeShot,
  extractPictureWords,
  framesInsideClip,
  matchEditHarnessSkill,
  pictureWordsAreCaptions,
  planSceneFrames,
  planSilenceRanges,
  rangesInsideClip,
  sceneProbeArgs,
  silenceProbeArgs,
  wordsLanded,
} from "./harness";

const SCRIPTED = [
  "Remove the silences",
  "Split at the scene changes",
  "Add captions from this script",
  "Auto captions",
  "Make it 9:16 for Reels",
  "Add a title 'Summer Sale' top centre, white with black outline",
  "Add a title card that says Hello",
  "Trim the first 3 seconds",
  "Move the second clip to the start",
  "Delete everything",
  "Undo the last change",
  "generate storyboard 4 shots (16:9, standard): a room",
  "animate storyboard",
  "run recipe podcast-clean-up",
  "Match look to the second clip",
  "Propose an alternate cut",
  "generate image (16:9, standard): a harbour",
  "generate video (16:9, standard): waves",
];

describe("edit harness skills", () => {
  it("names the five method-free sentences and leaves the scripted ones alone", () => {
    expect(matchEditHarnessSkill("Lift the dead air")).toBe("lift-dead-air");
    expect(matchEditHarnessSkill("Cut the pauses")).toBe("lift-dead-air");
    expect(matchEditHarnessSkill("Buang jeda")).toBe("lift-dead-air");
    expect(matchEditHarnessSkill("Cut where the picture changes")).toBe("cut-on-shots");
    expect(matchEditHarnessSkill("Potong saat gambar berubah")).toBe("cut-on-shots");
    expect(matchEditHarnessSkill("Put words on the picture: Hello")).toBe("words-on-picture");
    expect(matchEditHarnessSkill("Tulis di gambar: Halo")).toBe("words-on-picture");
    expect(matchEditHarnessSkill("Make a still of a harbour")).toBe("place-made-shot");
    expect(matchEditHarnessSkill("Buat klip ombak")).toBe("place-made-shot");
    expect(matchEditHarnessSkill("Hand me the file")).toBe("hand-back-file");
    expect(matchEditHarnessSkill("export")).toBe("hand-back-file");
    expect(matchEditHarnessSkill("Ekspor berkas")).toBe("hand-back-file");
    for (const sentence of SCRIPTED) {
      expect(matchEditHarnessSkill(sentence), sentence).toBeNull();
      const scripted =
        matchStubEditScenario(sentence) ?? matchStubFillScenario(sentence) ?? matchStubGenerateScenario(sentence);
      expect(scripted, sentence).not.toBeNull();
    }
  });

  it("retries a silence or scene probe once, and only keeps frames inside the clip", () => {
    const long = { timelineStartFrame: 0, durationFrames: 180 };
    const medium = { timelineStartFrame: 10, durationFrames: 60 };
    const tiny = { timelineStartFrame: 0, durationFrames: 20 };
    expect(planSilenceRanges(long, 0)).toEqual([{ startFrame: 72, endFrame: 108 }]);
    expect(planSilenceRanges(medium, 0)).toEqual([]);
    expect(planSilenceRanges(medium, 1)).toEqual([{ startFrame: 35, endFrame: 45 }]);
    expect(planSilenceRanges(tiny, 1)).toEqual([]);
    expect(silenceProbeArgs(0)).toEqual({ noiseDb: -30, minSeconds: 0.6 });
    expect(silenceProbeArgs(1).noiseDb).toBeLessThan(silenceProbeArgs(0).noiseDb);
    expect(planSceneFrames(long, 0)).toEqual([60, 120]);
    expect(planSceneFrames(medium, 0)).toEqual([]);
    expect(planSceneFrames(medium, 1)).toEqual([40]);
    expect(sceneProbeArgs(1).threshold).toBeLessThan(sceneProbeArgs(0).threshold);
    const clip = { timelineStartFrame: 0, durationFrames: 100, source: { inFrame: 0 } };
    expect(assetFramesToTimeline(clip, [{ startFrame: 20, endFrame: 40 }])).toEqual([{ startFrame: 20, endFrame: 40 }]);
    expect(assetFramesToTimeline(clip, [{ startFrame: 0, endFrame: 40 }])).toEqual([]);
    expect(rangesInsideClip(clip, [{ startFrame: 0, endFrame: 30 }])).toEqual([]);
    expect(framesInsideClip(long, [0, 180, 90, 90])).toEqual([90]);
  });

  it("reads the words and the shot from the sentence", () => {
    expect(extractPictureWords("Put words on the picture: Hello")).toBe("Hello");
    expect(extractPictureWords('Tulis di gambar: "Halo"')).toBe("Halo");
    expect(pictureWordsAreCaptions("Put words on the picture, captions: Hello")).toBe(true);
    expect(pictureWordsAreCaptions("Put words on the picture: Hello")).toBe(false);
    expect(wordsLanded([{ title: { text: "Hello" } }], "Hello", "title")).toBe(true);
    expect(wordsLanded([{ caption: { text: "Hello" } }], "Hello", "caption")).toBe(true);
    expect(wordsLanded([], "Hello", "title")).toBe(false);
    expect(extractMadeShot("Make a still of a harbour")).toEqual({ kind: "image", prompt: "a harbour" });
    expect(extractMadeShot("Buat klip ombak")).toEqual({ kind: "video", prompt: "ombak" });
  });
});
