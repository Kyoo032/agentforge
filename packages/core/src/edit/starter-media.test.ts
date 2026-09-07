import { describe, expect, it } from "vitest";
import { STARTER_PROJECTS } from "./recipes";
import { STARTER_MEDIA, starterMediaFile, starterMediaFileNames, starterTrackFor } from "./starter-media";

describe("starter media manifest", () => {
  it("parses and lists bundled files", () => {
    expect(STARTER_MEDIA.version).toBe(1);
    expect(starterMediaFileNames().length).toBeGreaterThan(0);
    for (const name of starterMediaFileNames()) {
      const file = starterMediaFile(name);
      expect(file).toBeDefined();
      expect(file?.durationSeconds).toBeGreaterThan(0);
    }
  });

  it("maps audio to a1 and video to v1", () => {
    const audio = starterMediaFile("music-bed-18s.m4a");
    const video = starterMediaFile("promo-skyline-16x9.mp4");
    expect(audio && starterTrackFor(audio)).toBe("a1");
    expect(video && starterTrackFor(video)).toBe("v1");
  });

  it("every starter media reference points at a bundled file", () => {
    for (const starter of STARTER_PROJECTS) {
      for (const ref of starter.media ?? []) {
        expect(starterMediaFile(ref), `${starter.id} references missing ${ref}`).toBeDefined();
      }
    }
  });

  it("starters with media match their aspect to the bundled video", () => {
    for (const starter of STARTER_PROJECTS) {
      for (const ref of starter.media ?? []) {
        const file = starterMediaFile(ref);
        if (file?.kind !== "video" || !file.width || !file.height) {
          continue;
        }
        const portrait = file.height > file.width;
        const square = file.height === file.width;
        const expected = square ? "1:1" : portrait ? "9:16" : "16:9";
        expect(starter.aspect, `${starter.id} uses ${ref}`).toBe(expected);
      }
    }
  });

  it("blank starters ship no media", () => {
    for (const starter of STARTER_PROJECTS.filter((item) => item.id.startsWith("blank-"))) {
      expect(starter.media ?? []).toHaveLength(0);
    }
  });
});
