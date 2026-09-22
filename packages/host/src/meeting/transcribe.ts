/**
 * Meeting mode — recording to text, through the Toko Token gateway.
 *
 * Two wires, because the gateway does not serve one shape for every recogniser
 * (docs/internal/gateway-model-selection.md §2.1):
 *
 *  - `chat_audio`            `POST /v1/chat/completions` with an `input_audio` part. This is how
 *                            every id that works on this gateway is driven; the encoding of the
 *                            bytes differs per model family (`./transcribe-request.ts`).
 *  - `audio_transcriptions`  multipart `POST /v1/audio/transcriptions`, the Whisper shape that
 *                            `edit/asr.ts` already speaks. Kept for a gateway that serves it.
 *
 * Nothing here invents a model id: when the live catalog lists no recogniser the caller is told so
 * and falls back to a pasted transcript. What it does do is try more than one — a single dead
 * model must not end a run that the tenant has already paid to encode.
 */

import { ApiError, resolveProviderKeys } from "@agentforge/core";
import {
  isTranscriptionModelId,
  transcriptionCandidates,
  transcriptionShapeFor,
  transcriptionWireFor,
  type TranscriptionWire,
} from "@agentforge/core/meeting";
import type { MeetingTranscript, TranscriptSegment } from "@agentforge/core/meeting";
import { loadModelCache } from "../model-cache";
import { loadSettings, type SettingsScope } from "../settings-store";
import { log } from "../log";
import { transcribeChunkWith } from "./transcribe-request";

export type MeetingAsrCapability = {
  available: boolean;
  model: string | null;
  wire: TranscriptionWire | null;
  /** Best first. The run walks this when a model refuses, so one bad id is not the end of the job. */
  candidates: string[];
  /** Why it is unavailable, for the UI to show instead of a silent empty transcript. */
  reason: "ok" | "no_model" | "no_key";
};

const NO_MODEL_MESSAGE = "This gateway key lists no speech-to-text model. Paste the transcript instead.";
const NO_KEY_MESSAGE = "Save a gateway key in Settings before transcribing.";

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
 * `AGENTFORGE_MEETING_ASR_MODEL` pins one id by hand — the same escape hatch Edit has as
 * `AGENTFORGE_EDIT_ASR_MODEL`, for a gateway whose catalog is ahead of the id lists in this repo.
 * A pin means exactly that: one model, no fallback, so a deliberate choice is never silently
 * replaced by ours.
 */
function candidateModels(): string[] {
  const pinned = process.env.AGENTFORGE_MEETING_ASR_MODEL?.trim();
  return pinned ? [pinned] : transcriptionCandidates(cachedModelIds());
}

/** Which recognisers this desk can use, best first. */
export function resolveMeetingAsr(tenant?: SettingsScope): MeetingAsrCapability {
  const key = resolveProviderKeys(loadSettings(tenant)).openai;
  const candidates = candidateModels();
  const model = candidates[0] ?? null;
  if (!model) {
    return { available: false, model: null, wire: null, candidates: [], reason: "no_model" };
  }
  const wire = transcriptionWireFor(model);
  if (!key) {
    return { available: false, model, wire, candidates, reason: "no_key" };
  }
  return { available: true, model, wire, candidates, reason: "ok" };
}

export type TranscribeOptions = {
  /** "en" / "id", or empty to let the recogniser decide. */
  language?: string;
  /**
   * Whose gateway key pays for the recognition. Phase 3 lane D: a `TenantContext`, never a bare
   * desk id, because a hosted call that cannot name its tenant must not spend another tenant's key.
   */
  tenant?: SettingsScope;
  /** Offset of each chunk from the start of the recording, in seconds. */
  offsets?: number[];
  fetchImpl?: typeof fetch;
  onChunk?: (index: number, total: number) => void;
  signal?: AbortSignal;
};

type ChunkAttempt = { text: string; model: string };

/** Every model that was asked and what it said, in one sentence the owner can act on. */
function chainFailure(failures: Array<{ model: string; error: unknown }>): ApiError {
  const last = failures[failures.length - 1]?.error;
  if (failures.length === 1 && last instanceof ApiError) {
    return last;
  }
  const detail = failures
    .map(({ model, error }) => `${model}: ${error instanceof Error ? error.message : String(error)}`)
    .join(" | ");
  return new ApiError(
    "transcription_failed",
    `No speech-to-text model on this gateway could read the recording. ${detail}`,
    last instanceof ApiError ? last.status : 502,
  );
}

/**
 * One chunk, walking the chain from whichever model last worked. A model that refuses, times out
 * or answers with nothing is dropped for the rest of this chunk and the next one is asked; the
 * first that answers becomes the preferred model for every chunk after it, so a healthy run still
 * makes exactly one call per chunk.
 */
async function transcribeOneChunk(
  file: string,
  models: string[],
  context: { base: string; key: string; options: TranscribeOptions },
): Promise<ChunkAttempt> {
  const failures: Array<{ model: string; error: unknown }> = [];
  for (const model of models) {
    try {
      const text = await transcribeChunkWith({
        file,
        model,
        base: context.base,
        key: context.key,
        ...(context.options.language ? { language: context.options.language } : {}),
        ...(context.options.signal ? { signal: context.options.signal } : {}),
        fetchImpl: context.options.fetchImpl ?? fetch,
      });
      if (text) {
        return { text, model };
      }
      // A 200 with no words is a refusal the gateway did not label as one. `gpt-audio` answers
      // exactly like that, which is why it is not on the preference list at all.
      failures.push({ model, error: new Error("answered with no text") });
      log.warn("meeting_chunk_empty", { model });
    } catch (error) {
      if (context.options.signal?.aborted) {
        throw error;
      }
      failures.push({ model, error });
      log.warn("meeting_chunk_model_failed", {
        model,
        code: error instanceof ApiError ? error.code : "internal_error",
      });
    }
  }
  throw chainFailure(failures);
}

/** The chain reordered so the model that just worked is asked first next time. */
function preferWorkingModel(models: string[], working: string): string[] {
  return [working, ...models.filter((model) => model !== working)];
}

/**
 * Transcribe every chunk in order. An empty answer is a failure, not a gap: unlike
 * `edit/asr.ts`, which skips a failed chunk and returns whatever is left, a meeting that lost a
 * ten-minute stretch would produce minutes that are quietly wrong about what was decided.
 */
export async function transcribeChunks(files: string[], options: TranscribeOptions = {}): Promise<MeetingTranscript> {
  const capability = resolveMeetingAsr(options.tenant);
  if (!capability.available || capability.candidates.length === 0) {
    throw new ApiError("asr_unavailable", capability.reason === "no_key" ? NO_KEY_MESSAGE : NO_MODEL_MESSAGE, 503);
  }
  const keys = resolveProviderKeys(loadSettings(options.tenant));
  const base = keys.openaiBaseUrl;
  const key = keys.openai;
  if (!base || !key) {
    throw new ApiError("asr_unavailable", NO_KEY_MESSAGE, 503);
  }
  let models = capability.candidates;
  const segments: TranscriptSegment[] = [];
  const used = new Set<string>();
  for (const [index, file] of files.entries()) {
    options.onChunk?.(index + 1, files.length);
    const attempt = await transcribeOneChunk(file, models, { base, key, options });
    models = preferWorkingModel(models, attempt.model);
    used.add(attempt.model);
    const startSeconds = options.offsets?.[index];
    segments.push({ ...(startSeconds === undefined ? {} : { startSeconds }), speaker: "", text: attempt.text });
  }
  return {
    text: segments
      .map((segment) => segment.text)
      .join("\n\n")
      .trim(),
    segments,
    language: options.language ?? "",
    source: "gateway",
    model: [...used].join(", "),
  };
}

export { isTranscriptionModelId, transcriptionShapeFor };
