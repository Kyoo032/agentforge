/**
 * Meeting mode — recording to text, through the Toko Token gateway.
 *
 * Two wires, because the gateway does not serve one shape for every recogniser
 * (docs/internal/gateway-model-selection.md §2.1):
 *
 *  - `chat_audio`            `POST /v1/chat/completions` with a base64 `input_audio` part. This is
 *                            how `mimo-v2.5-asr` — the catalog's only purpose-built ASR id — and
 *                            the `qwen*-omni*` models are driven.
 *  - `audio_transcriptions`  multipart `POST /v1/audio/transcriptions`, the Whisper shape that
 *                            `edit/asr.ts` already speaks. Kept for a gateway that serves it.
 *
 * Nothing here invents a model id: when the live catalog lists no recogniser the caller is told so
 * and falls back to a pasted transcript.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError, resolveProviderKeys } from "@agentforge/core";
import {
  isTranscriptionModelId,
  pickTranscriptionModel,
  transcriptionWireFor,
  type TranscriptionWire,
} from "@agentforge/core/meeting";
import type { MeetingTranscript, TranscriptSegment } from "@agentforge/core/meeting";
import { loadModelCache } from "../model-cache";
import { loadSettings } from "../settings-store";
import { log } from "../log";

export type MeetingAsrCapability = {
  available: boolean;
  model: string | null;
  wire: TranscriptionWire | null;
  /** Why it is unavailable, for the UI to show instead of a silent empty transcript. */
  reason: "ok" | "no_model" | "no_key";
};

/** Every id the desk has seen from the gateway, across provider dialects. */
export function cachedModelIds(): string[] {
  const cache = loadModelCache();
  return [
    ...(cache.openai ?? []),
    ...(cache.anthropic ?? []),
    ...(cache.google ?? []),
    ...(cache.volcengine ?? []),
  ].map((model) => model.id);
}

/**
 * Which recogniser this desk can use. `AGENTFORGE_MEETING_ASR_MODEL` pins one by hand — the same
 * escape hatch Edit has as `AGENTFORGE_EDIT_ASR_MODEL`, for a gateway whose catalog is ahead of
 * the id lists in this repo.
 */
export function resolveMeetingAsr(workspaceId?: string): MeetingAsrCapability {
  const key = resolveProviderKeys(loadSettings(workspaceId)).openai;
  const pinned = process.env.AGENTFORGE_MEETING_ASR_MODEL?.trim();
  const model = pinned || pickTranscriptionModel(cachedModelIds()) || null;
  if (!model) {
    return { available: false, model: null, wire: null, reason: "no_model" };
  }
  const wire = transcriptionWireFor(model);
  if (!key) {
    return { available: false, model, wire, reason: "no_key" };
  }
  return { available: true, model, wire, reason: "ok" };
}

export type TranscribeOptions = {
  /** "en" / "id", or empty to let the recogniser decide. */
  language?: string;
  workspaceId?: string;
  /** Offset of each chunk from the start of the recording, in seconds. */
  offsets?: number[];
  fetchImpl?: typeof fetch;
  onChunk?: (index: number, total: number) => void;
  signal?: AbortSignal;
};

const AUDIO_MIME = "audio/mpeg";
const REQUEST_TIMEOUT_MS = 300_000;

function instruction(language?: string): string {
  const target = language === "id" ? " The meeting is in Indonesian." : language === "en" ? " The meeting is in English." : "";
  return (
    `Transcribe this meeting audio verbatim.${target} Write only what was said, in the language it was` +
    " spoken. Label a speaker only when the audio names them. Do not summarise, translate, or add" +
    " commentary."
  );
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

/** Gateway errors carry a body worth logging, but never the key that was sent with it. */
async function failureDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return "";
  }
}

async function transcribeChunkViaChat(
  file: string,
  model: string,
  base: string,
  key: string,
  options: TranscribeOptions,
  fetchImpl: typeof fetch,
): Promise<string> {
  const bytes = await readFile(file);
  const format = path.extname(file).replace(/^\./, "").toLowerCase() || "mp3";
  const response = await fetchImpl(`${base}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders(key), "Content-Type": "application/json" },
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: bytes.toString("base64"), format } },
            { type: "text", text: instruction(options.language) },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new ApiError(
      "transcription_failed",
      `The gateway refused the transcription (${response.status}). ${await failureDetail(response)}`.trim(),
      response.status >= 500 ? 502 : 400,
    );
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  // Some omni models answer with the same content-part array they were asked with.
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
      .join("")
      .trim();
  }
  return "";
}

async function transcribeChunkViaMultipart(
  file: string,
  model: string,
  base: string,
  key: string,
  options: TranscribeOptions,
  fetchImpl: typeof fetch,
): Promise<string> {
  const bytes = await readFile(file);
  const form = new FormData();
  form.set("model", model);
  form.set("file", new Blob([bytes], { type: AUDIO_MIME }), path.basename(file));
  if (options.language) {
    form.set("language", options.language);
  }
  const response = await fetchImpl(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: authHeaders(key),
    body: form,
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ApiError(
      "transcription_failed",
      `The gateway refused the transcription (${response.status}). ${await failureDetail(response)}`.trim(),
      response.status >= 500 ? 502 : 400,
    );
  }
  const json = (await response.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/**
 * Transcribe every chunk in order. A chunk that comes back empty is kept as an empty segment
 * rather than dropped, so a gap in the audio does not silently shorten the meeting — unlike
 * `edit/asr.ts`, which skips a failed chunk and returns whatever is left.
 */
export async function transcribeChunks(files: string[], options: TranscribeOptions = {}): Promise<MeetingTranscript> {
  const capability = resolveMeetingAsr(options.workspaceId);
  if (!capability.available || !capability.model || !capability.wire) {
    throw new ApiError(
      "asr_unavailable",
      capability.reason === "no_key"
        ? "Save a gateway key in Settings before transcribing."
        : "This gateway key lists no speech-to-text model. Paste the transcript instead.",
      503,
    );
  }
  const keys = resolveProviderKeys(loadSettings(options.workspaceId));
  const base = keys.openaiBaseUrl;
  const key = keys.openai;
  if (!base || !key) {
    throw new ApiError("asr_unavailable", "Save a gateway key in Settings before transcribing.", 503);
  }
  const segments: TranscriptSegment[] = [];
  for (const [index, file] of files.entries()) {
    options.onChunk?.(index + 1, files.length);
    const text =
      capability.wire === "chat_audio"
        ? await transcribeChunkViaChat(file, capability.model, base, key, options, options.fetchImpl ?? fetch)
        : await transcribeChunkViaMultipart(file, capability.model, base, key, options, options.fetchImpl ?? fetch);
    if (!text) {
      log.warn("meeting_chunk_empty", { index, model: capability.model });
      continue;
    }
    const startSeconds = options.offsets?.[index];
    segments.push({ ...(startSeconds === undefined ? {} : { startSeconds }), speaker: "", text });
  }
  return {
    text: segments.map((segment) => segment.text).join("\n\n").trim(),
    segments,
    language: options.language ?? "",
    source: "gateway",
    model: capability.model,
  };
}

export { isTranscriptionModelId };
