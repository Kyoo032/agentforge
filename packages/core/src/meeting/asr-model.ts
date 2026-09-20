import { firstLiveId } from "../models/media-kind";

/**
 * How a transcription model is driven. The gateway's `supported_endpoint_types` never advertises
 * an audio/transcription type (docs/internal/gateway-model-selection.md §2.1): ASR and omni ids
 * expose `openai` only and carry their vendor's schema behind it. So `chat_audio` — chat
 * completions with a base64 `input_audio` part — is the wire that actually works on Toko Token,
 * and `audio_transcriptions` is kept for a Whisper-style id on a gateway that does serve it.
 */
export const TRANSCRIPTION_WIRES = ["audio_transcriptions", "chat_audio"] as const;
export type TranscriptionWire = (typeof TRANSCRIPTION_WIRES)[number];

/** Ids that take multipart `POST /v1/audio/transcriptions`. */
const MULTIPART_ID = /whisper|transcribe/i;
/** Ids that are speech recognition but not Whisper-shaped — `mimo-v2.5-asr` is the catalog's one ASR model. */
const ASR_ID = /(^|[-_.])asr([-_.]|$)|speech-to-text|\bstt\b/i;
/** Omni / audio-in text models: second-best, they hear the file and write the text out. */
const OMNI_ID = /omni|livetranslate|audio-|gemini-3[\w.]*-flash|doubao-seed-2-0-(?:lite|mini)/i;

/**
 * Ranked from the 2026-09-13 catalog snapshot (§5.3 "Speech, audio, music"). `mimo-v2.5-asr` is
 * the only purpose-built recogniser on the gateway; the omni ids behind it transcribe as a side
 * effect of understanding audio, which costs more and drifts more, so they are fallbacks.
 */
export const TRANSCRIPTION_PREF = [
  "mimo-v2.5-asr",
  "qwen3-livetranslate-flash",
  "qwen3.5-omni-flash",
  "qwen3.5-omni-plus",
  "qwen3-omni-flash-2025-12-01",
  "gemini-3.5-flash",
  "doubao-seed-2-0-lite-260428",
];

export function isTranscriptionModelId(id: string): boolean {
  const value = id.trim();
  if (!value) {
    return false;
  }
  return MULTIPART_ID.test(value) || ASR_ID.test(value) || OMNI_ID.test(value);
}

export function transcriptionWireFor(id: string): TranscriptionWire {
  return MULTIPART_ID.test(id.trim()) ? "audio_transcriptions" : "chat_audio";
}

/**
 * The best recogniser the live catalog actually lists, or `undefined` when it lists none — the
 * caller then falls back to a pasted transcript rather than inventing a model id the gateway
 * would 404 on.
 */
export function pickTranscriptionModel(ids: string[]): string | undefined {
  const usable = ids.filter(isTranscriptionModelId);
  return firstLiveId(TRANSCRIPTION_PREF, usable) ?? usable[0];
}
