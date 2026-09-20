import { describe, expect, it } from "vitest";
import {
  MUSIC_LYRICS_MAX,
  MUSIC_PROMPT_MAX,
  isMusicMode,
  musicCapabilities,
  resolveMusicMode,
  speechReachable,
  speechUnavailableReason,
  usesSunoMusicWire,
} from "./audio-capabilities";
import {
  DEFAULT_GATEWAY_MUSIC_MODEL,
  audioRole,
  isLyricsModelId,
  isMusicModelId,
  isSpeechModelId,
  mediaKind,
  pickPreferredLyricsModel,
  pickPreferredMusicModel,
  pickPreferredSpeechModel,
} from "./media-kind";

/** The audio ids docs/internal/gateway-model-selection.md section 5.3 records for this gateway. */
const LIVE_AUDIO_IDS = [
  "suno_music",
  "suno_lyrics",
  "qwen3-tts-instruct-flash-realtime",
  "qwen-audio-3.0-realtime-plus",
  "qwen-audio-3.0-realtime-flash",
  "qwen3.5-omni-plus-realtime",
  "qwen3.5-omni-flash",
];

describe("audioRole", () => {
  it("separates a song generator from a lyric writer", () => {
    expect(audioRole("suno_music")).toBe("music");
    expect(audioRole("suno_lyrics")).toBe("lyrics");
    expect(isMusicModelId("suno_music")).toBe(true);
    expect(isMusicModelId("suno_lyrics")).toBe(false);
    expect(isLyricsModelId("suno_lyrics")).toBe(true);
  });

  it("calls the realtime TTS id realtime, not speech", () => {
    // It speaks WebSocket behind an `openai` endpoint label, so a job route cannot drive it.
    expect(audioRole("qwen3-tts-instruct-flash-realtime")).toBe("realtime");
    expect(isSpeechModelId("qwen3-tts-instruct-flash-realtime")).toBe(false);
  });

  it("calls a plain TTS id speech", () => {
    expect(audioRole("qwen-audio-3.0-tts-flash")).toBe("speech");
    expect(isSpeechModelId("qwen-audio-3.0-tts-flash")).toBe(true);
  });

  it("calls a transcriber transcribe", () => {
    expect(audioRole("whisper-1")).toBe("transcribe");
  });

  it("answers other for anything outside the audio bucket", () => {
    expect(mediaKind("gpt-5.6-terra")).toBe("chat");
    expect(audioRole("gpt-5.6-terra")).toBe("other");
    expect(audioRole("")).toBe("other");
  });
});

describe("preferred audio models", () => {
  it("picks the live music and lyrics ids", () => {
    expect(pickPreferredMusicModel(LIVE_AUDIO_IDS)).toBe("suno_music");
    expect(pickPreferredLyricsModel(LIVE_AUDIO_IDS)).toBe("suno_lyrics");
  });

  it("falls back to the kernel music default when the catalog is empty", () => {
    expect(pickPreferredMusicModel([])).toBe(DEFAULT_GATEWAY_MUSIC_MODEL);
  });

  it("returns no speech model rather than inventing one", () => {
    // Guessing an id here would send the desk at a model the gateway does not serve.
    expect(pickPreferredSpeechModel(LIVE_AUDIO_IDS)).toBe("");
    expect(pickPreferredSpeechModel([])).toBe("");
  });
});

describe("speech reachability", () => {
  it("reports realtime_only for this gateway's live catalog", () => {
    expect(speechReachable(LIVE_AUDIO_IDS)).toBe(false);
    expect(speechUnavailableReason(LIVE_AUDIO_IDS)).toBe("realtime_only");
  });

  it("reports no_audio_models when nothing audio is listed", () => {
    expect(speechUnavailableReason(["gpt-5.6-terra"])).toBe("no_audio_models");
  });

  it("turns itself on the day a plain TTS id appears", () => {
    const next = [...LIVE_AUDIO_IDS, "qwen-audio-3.0-tts-flash"];
    expect(speechReachable(next)).toBe(true);
    expect(speechUnavailableReason(next)).toBeNull();
  });
});

describe("musicCapabilities", () => {
  it("gives a Suno id every field", () => {
    expect(usesSunoMusicWire("suno_music")).toBe(true);
    expect(musicCapabilities("suno_music")).toEqual({
      lyrics: true,
      style: true,
      title: true,
      instrumental: true,
    });
  });

  it("gives an unknown id the description box and nothing else", () => {
    expect(musicCapabilities("lyria-2")).toEqual({
      lyrics: false,
      style: false,
      title: false,
      instrumental: false,
    });
  });

  it("does not return the shared object, so a caller cannot edit it", () => {
    const first = musicCapabilities("suno_music");
    first.lyrics = false;
    expect(musicCapabilities("suno_music").lyrics).toBe(true);
  });
});

describe("resolveMusicMode", () => {
  it("keeps custom mode on a model that accepts lyrics", () => {
    expect(resolveMusicMode("suno_music", "custom")).toBe("custom");
  });

  it("downgrades custom to describe when the model has no lyrics field", () => {
    expect(resolveMusicMode("lyria-2", "custom")).toBe("describe");
  });

  it("defaults to describe for anything unrecognised", () => {
    expect(resolveMusicMode("suno_music")).toBe("describe");
    expect(resolveMusicMode("suno_music", "nonsense")).toBe("describe");
  });

  it("guards the mode type", () => {
    expect(isMusicMode("custom")).toBe(true);
    expect(isMusicMode("nonsense")).toBe(false);
    expect(isMusicMode(null)).toBe(false);
  });
});

describe("caps", () => {
  it("keeps lyrics room well above the description box", () => {
    expect(MUSIC_LYRICS_MAX).toBeGreaterThan(MUSIC_PROMPT_MAX);
  });
});
