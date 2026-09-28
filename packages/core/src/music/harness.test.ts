import { describe, expect, it } from "vitest";
import { outputLanguageRule } from "../output-language";
import {
  lyricsAreSingable,
  preferLyricDraft,
  resolveSongTitle,
  shouldRetryLyrics,
  shouldRetryMusicJob,
  songTitleFromBrief,
  stripMusicLanguageRule,
} from "./harness";

const RULE = outputLanguageRule("music", "en");

describe("new music skills", () => {
  it("runs shape-lyric: a one-line draft is retried, a two-line draft is kept", () => {
    expect(lyricsAreSingable("Rain")).toBe(false);
    expect(shouldRetryLyrics(1, "Rain")).toBe(true);
    const sung = "Rain on the window\nI keep the porch light on";
    expect(lyricsAreSingable(sung)).toBe(true);
    expect(shouldRetryLyrics(1, sung)).toBe(false);
    expect(shouldRetryLyrics(2, "Rain")).toBe(false);
    expect(preferLyricDraft("Rain", sung)).toBe(sung);
    expect(preferLyricDraft(`${sung}\n${RULE}`, "Nope")).toBe(sung);
    expect(stripMusicLanguageRule(`Verse\nRain on the window\n\n${RULE}`)).toBe("Verse\nRain on the window");
  });

  it("runs name-song: a blank title comes from the brief, and a title they typed wins", () => {
    expect(songTitleFromBrief("A quiet song about the rain.")).toBe("A quiet song about the rain");
    expect(songTitleFromBrief("Chorus\nRain on the window\nStay")).toBe("Rain on the window");
    expect(resolveSongTitle({ brief: "Rain on the glass", ownerTitle: "Porch light" })).toBe("Porch light");
    expect(resolveSongTitle({ brief: "Rain on the glass", takeTitle: "Take from the relay" })).toBe(
      "Take from the relay",
    );
    expect(resolveSongTitle({ brief: "Rain on the glass" })).toBe("Rain on the glass");
  });

  it("runs both-takes: a blank job is submitted once more, and a job that returned tracks is not", () => {
    expect(shouldRetryMusicJob(1, 0)).toBe(true);
    expect(shouldRetryMusicJob(1, 2)).toBe(false);
    expect(shouldRetryMusicJob(2, 0)).toBe(false);
  });
});
