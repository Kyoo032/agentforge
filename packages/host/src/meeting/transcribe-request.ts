/**
 * Meeting mode — one chunk, one model, one gateway call.
 *
 * Split out of `./transcribe.ts` because the request shape is per model *family* and not per
 * install, and each difference below cost a live 400 to learn (2026-09-21, against
 * `https://api.tokotokenai.com/v1`):
 *
 *  - the OpenAI audio family (`gpt-audio-mini`, `gpt-audio-1.5`) takes **bare base64** and answers
 *    `400 invalid_value` to a data URI;
 *  - the DashScope-backed family (`qwen*-omni*`, `*livetranslate*`) takes a **`data:` URI** and
 *    answers `400 InvalidParameter` — "The provided URL does not appear to be valid" — to bare
 *    base64, and is the family §5.3 of the model-selection doc says wants `stream=True`;
 *  - a Whisper-shaped id goes multipart, the wire `edit/asr.ts` already speaks.
 *
 * Every refusal is turned into a sentence that names the model and repeats what the gateway said,
 * because the owner reads it in an SSE `job.error` frame and has no other view of the call.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@agentforge/core";
import { transcriptionShapeFor, type AudioEncoding } from "@agentforge/core/meeting";

/** One chunk is ten minutes of speech-grade audio; a slow recogniser still has to finish inside this. */
export const REQUEST_TIMEOUT_MS = 300_000;
/** How much of a gateway error body is worth repeating to the owner. */
const FAILURE_DETAIL_CHARS = 400;
const AUDIO_MIME = "audio/mpeg";
const SSE_DATA_PREFIX = "data:";
const SSE_DONE = "[DONE]";

export type ChunkRequest = {
  file: string;
  model: string;
  base: string;
  key: string;
  /** "en" / "id", or undefined to let the recogniser decide. */
  language?: string;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
};

function instruction(language?: string): string {
  const target =
    language === "id" ? " The meeting is in Indonesian." : language === "en" ? " The meeting is in English." : "";
  return (
    `Transcribe this meeting audio verbatim.${target} Write only what was said, in the language it was` +
    " spoken. Label a speaker only when the audio names them. Do not summarise, translate, or add" +
    " commentary."
  );
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}` };
}

/**
 * The caller's abort signal *and* a hard per-request budget. Before this, passing a job's signal
 * replaced the timeout entirely (PR #66 finding 7), so a hung gateway call waited for the browser
 * to disconnect — which on a background run is never.
 */
function requestSignal(signal?: AbortSignal): AbortSignal {
  const budget = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, budget]) : budget;
}

function audioPayload(bytes: Buffer, format: string, encoding: AudioEncoding): string {
  const base64 = bytes.toString("base64");
  return encoding === "data_uri" ? `data:audio/${format};base64,${base64}` : base64;
}

/** The gateway's own words, not ours: `{"error":{"message":…}}` when it sends one, else the body. */
async function refusalReason(response: Response): Promise<string> {
  let raw = "";
  try {
    raw = await response.text();
  } catch {
    return "";
  }
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown; code?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().slice(0, FAILURE_DETAIL_CHARS);
    }
  } catch {
    // Not JSON; the raw body is the best reason there is.
  }
  return raw.trim().slice(0, FAILURE_DETAIL_CHARS);
}

async function refusal(model: string, response: Response): Promise<ApiError> {
  const reason = await refusalReason(response);
  return new ApiError(
    "transcription_failed",
    `The gateway refused the transcription with ${model} (${response.status})${reason ? `: ${reason}` : ""}.`,
    response.status >= 500 ? 502 : 400,
  );
}

/** Text out of a chat `content`, which is a string on most ids and a content-part array on some. */
export function textFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
      .join("");
  }
  return "";
}

/** Accumulate the `delta.content` of an OpenAI-style SSE stream. A keepalive or `[DONE]` is skipped. */
export function textFromEventStream(body: string): string {
  let out = "";
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(SSE_DATA_PREFIX)) {
      continue;
    }
    const payload = trimmed.slice(SSE_DATA_PREFIX.length).trim();
    if (!payload || payload === SSE_DONE) {
      continue;
    }
    try {
      const frame = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown } }> };
      out += textFromContent(frame.choices?.[0]?.delta?.content ?? "");
    } catch {
      // A frame we cannot read is one frame, never the whole transcript.
    }
  }
  return out;
}

async function viaChat(request: ChunkRequest): Promise<string> {
  const shape = transcriptionShapeFor(request.model);
  const bytes = await readFile(request.file);
  const format = path.extname(request.file).replace(/^\./, "").toLowerCase() || "mp3";
  const response = await request.fetchImpl(`${request.base}/chat/completions`, {
    method: "POST",
    headers: { ...authHeaders(request.key), "Content-Type": "application/json" },
    signal: requestSignal(request.signal),
    body: JSON.stringify({
      model: request.model,
      ...(shape.stream ? { stream: true } : {}),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: audioPayload(bytes, format, shape.audioEncoding), format },
            },
            { type: "text", text: instruction(request.language) },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw await refusal(request.model, response);
  }
  const raw = await response.text();
  if (shape.stream) {
    return textFromEventStream(raw).trim();
  }
  const json = JSON.parse(raw) as { choices?: Array<{ message?: { content?: unknown } }> };
  return textFromContent(json.choices?.[0]?.message?.content).trim();
}

async function viaMultipart(request: ChunkRequest): Promise<string> {
  const bytes = await readFile(request.file);
  const form = new FormData();
  form.set("model", request.model);
  form.set("file", new Blob([bytes], { type: AUDIO_MIME }), path.basename(request.file));
  if (request.language) {
    form.set("language", request.language);
  }
  const response = await request.fetchImpl(`${request.base}/audio/transcriptions`, {
    method: "POST",
    headers: authHeaders(request.key),
    body: form,
    signal: requestSignal(request.signal),
  });
  if (!response.ok) {
    throw await refusal(request.model, response);
  }
  const json = (await response.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/** One chunk through whichever wire this model speaks. */
export function transcribeChunkWith(request: ChunkRequest): Promise<string> {
  return transcriptionShapeFor(request.model).wire === "audio_transcriptions"
    ? viaMultipart(request)
    : viaChat(request);
}
