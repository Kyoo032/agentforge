import { audioRole, firstLiveId, mediaKind } from "../models/media-kind";

/**
 * How a transcription model is driven. The gateway's `supported_endpoint_types` never advertises
 * an audio/transcription type (docs/internal/gateway-model-selection.md §2.1): ASR and omni ids
 * expose `openai` only and carry their vendor's schema behind it. So `chat_audio` — chat
 * completions with an `input_audio` part — is the wire that actually works on Toko Token, and
 * `audio_transcriptions` is kept for a Whisper-style id on a gateway that does serve it.
 */
export const TRANSCRIPTION_WIRES = ["audio_transcriptions", "chat_audio"] as const;
export type TranscriptionWire = (typeof TRANSCRIPTION_WIRES)[number];

/**
 * How the bytes go into `input_audio.data`. Driven against the live gateway on 2026-09-21:
 *
 *  - `base64`   bare base64, what the OpenAI audio family takes. Handed a data URI it answers
 *               `400 invalid_value` — "Expected base64-encoded data but got an invalid
 *               base64-encoded value".
 *  - `data_uri` `data:audio/<format>;base64,…`, what the DashScope-backed qwen / omni ids take.
 *               Handed bare base64 they answer `400 InvalidParameter` — "The provided URL does not
 *               appear to be valid".
 *
 * One shape cannot serve both, which is why this is per model and not a constant.
 */
export const AUDIO_ENCODINGS = ["base64", "data_uri"] as const;
export type AudioEncoding = (typeof AUDIO_ENCODINGS)[number];

export type TranscriptionShape = {
  wire: TranscriptionWire;
  audioEncoding: AudioEncoding;
  /** `true` sends `stream: true` and accumulates the SSE deltas. */
  stream: boolean;
};

/** Ids that take multipart `POST /v1/audio/transcriptions`. */
const MULTIPART_ID = /whisper|transcribe/i;
/** Purpose-built recognisers that are not Whisper-shaped — `mimo-v2.5-asr` is the documented one. */
const ASR_ID = /(^|[-_.])asr([-_.]|$)|speech-to-text|\bstt\b/i;
/** Audio-in text models: they hear the file and write the text out. */
const OMNI_ID = /omni|livetranslate|audio-|gemini-3[\w.]*-flash|doubao-seed-2-0-(?:lite|mini)/i;
/**
 * The DashScope-backed family. Section 5.3 of the model-selection doc says these want `stream=True`;
 * the live drive adds that they want the audio as a data URI. Both are sent, and both work.
 */
const DASHSCOPE_ID = /qwen|doubao|omni|livetranslate/i;
/** WebSocket behind an `openai` endpoint label (§2.1): unreachable from an HTTP job route. */
const REALTIME_ID = /realtime/i;
/** Text-to-speech. It talks, it does not listen. */
const TTS_ID = /\btts\b|-tts|tts-|text-to-speech/i;
/** A model whose job is pictures, clips or moderation can never be asked to transcribe. */
const CANNOT_HEAR = new Set(["image", "video", "other"]);

/**
 * Ranked by what was driven against the live Toko Token gateway on 2026-09-21, most accurate
 * first, with a 14-second synthetic recording of a three-speaker meeting:
 *
 *  1. `gemini-3.5-flash`            verbatim and the only id that labelled the speakers.
 *  2. `gpt-audio-mini`              verbatim, fastest (~3 s for 14 s of audio), no speaker labels.
 *  3. `gpt-audio-1.5`               verbatim, but non-streaming wraps the text in a JSON object.
 *  4. `qwen3-omni-flash-2025-12-01` verbatim, and only with a data URI.
 *  5. `mimo-v2.5-asr`               absent from this catalog; kept because a gateway that adds the
 *                                   one purpose-built recogniser should use it.
 *
 * Deliberately absent, each for a reason the drive recorded: `qwen3-livetranslate-flash`,
 * `qwen3.5-omni-flash` and `qwen3.5-omni-plus` all answer `503 get_channel_failed` ("Supply pool
 * unavailable"), and `gpt-audio` answers 200 with a refusal ("I'm sorry, but I can't provide that
 * transcription") on both wires.
 */
export const TRANSCRIPTION_PREF = [
  "gemini-3.5-flash",
  "gpt-audio-mini",
  "gpt-audio-1.5",
  "qwen3-omni-flash-2025-12-01",
  "mimo-v2.5-asr",
];

/** A recogniser this repo has never heard of, but whose id says plainly what it is. */
function isPurposeBuiltRecogniser(id: string): boolean {
  return audioRole(id) === "transcribe";
}

export function isTranscriptionModelId(id: string): boolean {
  const value = id.trim();
  if (!value) {
    return false;
  }
  if (REALTIME_ID.test(value) || TTS_ID.test(value)) {
    return false;
  }
  if (CANNOT_HEAR.has(mediaKind(value))) {
    return false;
  }
  return MULTIPART_ID.test(value) || ASR_ID.test(value) || OMNI_ID.test(value);
}

export function transcriptionShapeFor(id: string): TranscriptionShape {
  const value = id.trim();
  if (MULTIPART_ID.test(value)) {
    return { wire: "audio_transcriptions", audioEncoding: "base64", stream: false };
  }
  if (DASHSCOPE_ID.test(value)) {
    return { wire: "chat_audio", audioEncoding: "data_uri", stream: true };
  }
  return { wire: "chat_audio", audioEncoding: "base64", stream: false };
}

export function transcriptionWireFor(id: string): TranscriptionWire {
  return transcriptionShapeFor(id).wire;
}

/**
 * Every recogniser this desk could use, best first — a chain, not a pick, because one model with a
 * dead supply pool must not end the run. Preferred ids in order, then any purpose-built recogniser
 * the catalog lists that this repo has not heard of.
 *
 * A model that merely *could* hear is never appended: the old `usable[0]` fallback would happily
 * have handed a meeting to a video model. An empty list is the honest answer, and the caller falls
 * back to a pasted transcript rather than inventing an id.
 */
export function transcriptionCandidates(ids: string[]): string[] {
  const usable = ids.filter(isTranscriptionModelId);
  const chain: string[] = [];
  for (const want of TRANSCRIPTION_PREF) {
    const live = firstLiveId([want], usable);
    if (live && !chain.includes(live)) {
      chain.push(live);
    }
  }
  for (const id of usable) {
    if (isPurposeBuiltRecogniser(id) && !chain.includes(id)) {
      chain.push(id);
    }
  }
  return chain;
}

/**
 * The best recogniser the live catalog actually lists, or `undefined` when it lists none — the
 * caller then falls back to a pasted transcript rather than inventing a model id the gateway
 * would 404 on.
 */
export function pickTranscriptionModel(ids: string[]): string | undefined {
  return transcriptionCandidates(ids)[0];
}
