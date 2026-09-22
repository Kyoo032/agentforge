/**
 * Meeting mode — which live id may be asked to transcribe, and how it wants to be asked.
 *
 * Every expectation here was driven against the live Toko Token gateway on 2026-09-21 with a
 * 14-second synthetic recording (see docs/internal/maps/meeting-minutes.md). The ids that failed
 * are pinned as hard as the ones that worked: a preference list that re-admits a model which
 * answers `Supply pool unavailable`, refuses to transcribe, or speaks WebSocket only is the exact
 * bug this file exists to stop coming back.
 */

import { describe, expect, it } from "vitest";
import {
  TRANSCRIPTION_PREF,
  isTranscriptionModelId,
  pickTranscriptionModel,
  transcriptionCandidates,
  transcriptionShapeFor,
  transcriptionWireFor,
} from "./asr-model";

/** The audio-capable half of the live catalog on 2026-09-21 (139 ids in total). */
const LIVE_AUDIO_IDS = [
  "gemini-3-flash",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-pro",
  "gemini-3.5-flash",
  "qwen-audio-3.0-realtime-flash",
  "qwen-audio-3.0-realtime-plus",
  "qwen3-livetranslate-flash",
  "qwen3-omni-flash-2025-12-01",
  "qwen3-omni-flash-realtime",
  "qwen3-tts-instruct-flash-realtime",
  "qwen3.5-livetranslate-flash-realtime",
  "qwen3.5-omni-flash",
  "qwen3.5-omni-plus",
  "qwen3.5-omni-plus-realtime",
  "gpt-4o-mini-tts",
  "gpt-audio",
  "gpt-audio-1.5",
  "gpt-audio-mini",
  "gpt-realtime",
  "gpt-realtime-2.1",
  "omni-moderation-latest",
  "omni-fast-v2v",
];

describe("isTranscriptionModelId", () => {
  it("admits the ids proven to transcribe on this gateway", () => {
    for (const id of ["gemini-3.5-flash", "gpt-audio-mini", "gpt-audio-1.5", "qwen3-omni-flash-2025-12-01"]) {
      expect(isTranscriptionModelId(id)).toBe(true);
    }
  });

  it("still admits a purpose-built recogniser and a whisper-style id", () => {
    expect(isTranscriptionModelId("mimo-v2.5-asr")).toBe(true);
    expect(isTranscriptionModelId("whisper-1")).toBe(true);
  });

  it("refuses every realtime id, because those speak WebSocket and not HTTP", () => {
    for (const id of LIVE_AUDIO_IDS.filter((value) => value.includes("realtime"))) {
      expect(isTranscriptionModelId(id)).toBe(false);
    }
  });

  it("refuses a text-to-speech id: it talks, it does not listen", () => {
    expect(isTranscriptionModelId("gpt-4o-mini-tts")).toBe(false);
    expect(isTranscriptionModelId("tts-1-hd")).toBe(false);
  });

  it("refuses image, video and moderation ids the old omni pattern let through", () => {
    for (const id of [
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-lite-image",
      "gemini-3-pro-image-preview",
      "omni-fast-v2v",
      "omni-moderation-latest",
    ]) {
      expect(isTranscriptionModelId(id)).toBe(false);
    }
  });
});

describe("transcriptionShapeFor", () => {
  it("asks a whisper-style id over multipart", () => {
    expect(transcriptionShapeFor("whisper-1")).toMatchObject({ wire: "audio_transcriptions" });
    expect(transcriptionWireFor("whisper-1")).toBe("audio_transcriptions");
  });

  it("sends bare base64 to the OpenAI audio family, which refuses a data URI with a 400", () => {
    expect(transcriptionShapeFor("gpt-audio-mini")).toEqual({
      wire: "chat_audio",
      audioEncoding: "base64",
      stream: false,
    });
    expect(transcriptionShapeFor("gemini-3.5-flash")).toMatchObject({ audioEncoding: "base64" });
  });

  it("sends a data URI and streams for the qwen/omni family, which refuses bare base64", () => {
    for (const id of ["qwen3-omni-flash-2025-12-01", "qwen3.5-omni-plus", "qwen3-livetranslate-flash"]) {
      expect(transcriptionShapeFor(id)).toEqual({ wire: "chat_audio", audioEncoding: "data_uri", stream: true });
    }
  });
});

describe("transcriptionCandidates", () => {
  it("heads the chain with the most accurate model proven on this gateway", () => {
    expect(transcriptionCandidates(LIVE_AUDIO_IDS)[0]).toBe("gemini-3.5-flash");
  });

  it("never offers a realtime, TTS, image or moderation id as a fallback", () => {
    for (const id of transcriptionCandidates(LIVE_AUDIO_IDS)) {
      expect(id).not.toMatch(/realtime|tts|image|moderation|v2v/i);
    }
  });

  it("keeps a chain rather than one model, so a dead supply pool does not kill the run", () => {
    expect(transcriptionCandidates(LIVE_AUDIO_IDS).length).toBeGreaterThan(1);
  });

  it("offers an unlisted purpose-built recogniser, but never an unlisted chat model", () => {
    expect(transcriptionCandidates(["some-new-asr-v9", "gpt-5.6-sol"])).toEqual(["some-new-asr-v9"]);
  });

  it("is empty when the catalog lists nothing that can hear", () => {
    expect(transcriptionCandidates(["gpt-realtime", "gpt-4o-mini-tts", "gpt-5.6-sol"])).toEqual([]);
    expect(pickTranscriptionModel(["gpt-realtime", "gpt-4o-mini-tts"])).toBeUndefined();
  });

  it("picks the head of the chain", () => {
    expect(pickTranscriptionModel(LIVE_AUDIO_IDS)).toBe(transcriptionCandidates(LIVE_AUDIO_IDS)[0]);
  });
});

describe("TRANSCRIPTION_PREF", () => {
  it("lists no id that failed against the live gateway on 2026-09-21", () => {
    // qwen3-livetranslate-flash / qwen3.5-omni-* answered 503 get_channel_failed ("Supply pool
    // unavailable"); gpt-audio answered 200 with "I'm sorry, but I can't provide that transcription".
    for (const dead of ["qwen3-livetranslate-flash", "qwen3.5-omni-flash", "qwen3.5-omni-plus", "gpt-audio"]) {
      expect(TRANSCRIPTION_PREF).not.toContain(dead);
    }
  });
});
