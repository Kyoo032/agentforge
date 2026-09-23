/**
 * Meeting mode — the run: recording → transcript → minutes → the other language.
 *
 * Every phase is resumable on its own, because they fail for different reasons and for different
 * lengths of time. Transcription costs a gateway call per ten minutes of audio and is the step
 * worth not repeating, so it is persisted before the minutes are written. A desk with no
 * recogniser on its key skips straight to the minutes over a pasted transcript.
 */

import { rm } from "node:fs/promises";
import {
  ApiError,
  gatewayRequiredMessage,
  hasLiveProvider,
  parseAppLocale,
  resolveChatModel,
  resolveRuntimeMode,
  withOutputLanguage,
  type AppLocale,
  type TenantContext,
} from "@agentforge/core";
import {
  MEETING_MINUTES_SYSTEM,
  MEETING_TRANSLATE_SYSTEM,
  guardMinutesNames,
  meetingMinutesSchema,
  meetingMinutesToMarkdown,
  meetingTranscriptToMarkdown,
  minutesPrompt,
  transcriptPlainText,
  translatePrompt,
  type MeetingMinutes,
  type MeetingTranscript,
} from "@agentforge/core/meeting";
import { extractJsonObject } from "../presentation-outline";
import { artifactStore } from "../artifacts";
import { collectJobAssistantRun } from "../job-regen";
import type { JobEmitter } from "@agentforge/core/jobs";
import { throwIfJobAborted } from "../job-stream";
import { artifactWorkCard } from "../work-cards";
import { upsertWorkSource } from "../knowledge-ingest";
import { loadSettings, type SettingsScope } from "../settings-store";
import { listSelectableModels, modeCatalogPayload } from "../selectable-models";
import { localeForRun } from "../run-context";
import { log } from "../log";
import { recordTranscriptionUsage } from "../usage-record";
import { extractMeetingAudio, type ExtractedAudio } from "./audio";
import { meetingStore, requireMeeting, type MeetingRecord } from "./store";
import { resolveMeetingAsr, transcribeChunks } from "./transcribe";
import type { MeetingMinutesRecord } from "./records";

const NO_EMIT: JobEmitter = () => {};

/** The language a set of minutes gets translated into: whichever of the two it is not in. */
export function otherLocale(locale: AppLocale): AppLocale {
  return locale === "en" ? "id" : "en";
}

function requireLiveMeetingRuntime(tenant: SettingsScope): void {
  const settings = loadSettings(tenant);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", gatewayRequiredMessage("meeting", localeForRun()), 503);
  }
}

export function resolveMeetingModel(explicit: string | undefined, tenant: SettingsScope): string {
  const settings = loadSettings(tenant);
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(explicit, settings.documentGenModel || defaults.meeting, listSelectableModels());
}

function parseMinutes(raw: string): MeetingMinutes {
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "The model returned no minutes", 502);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    throw new ApiError("invalid_minutes", "The model returned invalid JSON for the minutes", 502);
  }
  const result = meetingMinutesSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(
      "invalid_minutes",
      `Minutes failed validation: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
      502,
    );
  }
  return result.data;
}

/** Saving an artifact never fails the run; the minutes are still returned to the caller. */
function persist(
  tenant: TenantContext,
  input: { kind: "transcript" | "minutes"; title: string; body: string; meta: Record<string, unknown> },
): string {
  try {
    return artifactStore().create(tenant, {
      mode: "meeting",
      kind: input.kind,
      title: input.title,
      mime: "text/markdown",
      body: input.body,
      meta: input.meta,
    }).id;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("meeting_artifact_not_saved", { code, kind: input.kind });
    return "";
  }
}

async function fileWorkCard(
  tenant: TenantContext,
  input: { artifactId: string; title: string; markdown: string; model: string },
): Promise<void> {
  if (!input.artifactId) {
    return;
  }
  try {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({
        type: "Meeting",
        artifactId: input.artifactId,
        title: input.title,
        markdown: input.markdown,
        model: input.model,
      }),
    );
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("meeting_work_card_not_filed", { code });
  }
}

/**
 * Recording → transcript. Persists on the meeting before returning, so a later failure writing the
 * minutes never costs the transcription again.
 */
export async function transcribeMeeting(
  tenant: TenantContext,
  meetingId: string,
  options: { emit?: JobEmitter; abortSignal?: AbortSignal; language?: string } = {},
): Promise<MeetingRecord> {
  const emit = options.emit ?? NO_EMIT;
  const meeting = requireMeeting(tenant, meetingId);
  const source = meetingStore().recordingPath(tenant, meetingId);
  if (!source) {
    throw new ApiError("invalid_request", "Upload a recording before transcribing", 400);
  }
  const capability = resolveMeetingAsr(tenant);
  if (!capability.available) {
    throw new ApiError(
      "asr_unavailable",
      capability.reason === "no_key"
        ? "Save a gateway key in Settings before transcribing."
        : "This gateway key lists no speech-to-text model. Paste the transcript instead.",
      503,
    );
  }
  throwIfJobAborted(options.abortSignal);
  emit({ type: "job.phase", phase: "extracting", label: "Reading the recording" });
  const workspace = meetingStore().audioWorkspace(tenant, meetingId);
  try {
    // Inside the `try`: ffmpeg can fail after writing some chunks, and a cancel can land the moment
    // it finishes. Either way the chunks must not outlive the run.
    const audio = await extractMeetingAudio(source, workspace.dir, workspace.allow);
    throwIfJobAborted(options.abortSignal);
    emit({
      type: "job.phase",
      phase: "transcribing",
      label: `Transcribing with ${capability.model}`,
    });
    const transcript = await transcribeAndMeter(tenant, audio, {
      language: options.language ?? meeting.locale,
      model: capability.model ?? "",
      emit,
      abortSignal: options.abortSignal,
    });
    if (!transcriptPlainText(transcript)) {
      throw new ApiError("transcription_empty", "The recogniser returned nothing for that recording", 502);
    }
    return saveTranscript(tenant, meetingId, transcript);
  } finally {
    // The chunks are a cache of the recording, which is still on disk; keeping them would double
    // every meeting's footprint for nothing.
    await rm(workspace.dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Every chunk through the recogniser, metered in seconds of audio. When a later chunk fails, the
 * chunks before it were still answered, and billed, by the gateway, so their share is recorded
 * before the error goes on.
 */
async function transcribeAndMeter(
  tenant: TenantContext,
  audio: ExtractedAudio,
  options: { language: string; model: string; emit: JobEmitter; abortSignal?: AbortSignal },
): Promise<MeetingTranscript> {
  let answered = 0;
  let transcript: MeetingTranscript;
  try {
    transcript = await transcribeChunks(audio.files, {
      language: options.language,
      tenant,
      offsets: audio.offsets,
      signal: options.abortSignal,
      onChunk: (current, total) => {
        // Announced before its chunk is sent, so every chunk before this one has answered.
        answered = current - 1;
        options.emit({ type: "job.step", phase: "transcribing", label: "Audio", current, total });
      },
    });
  } catch (error) {
    if (answered > 0) {
      // The first chunk that did not answer starts where the billed audio ends.
      recordTranscriptionUsage(tenant, {
        model: options.model,
        seconds: audio.offsets[answered] ?? audio.durationSeconds,
      });
    }
    throw error;
  }
  // Recorded before the transcript is judged: the gateway has already charged for the audio,
  // so a recogniser that answers with nothing is still a call the tenant pays for.
  recordTranscriptionUsage(tenant, {
    model: transcript.model || options.model,
    seconds: audio.durationSeconds,
  });
  return transcript;
}

/** Store a transcript — gateway-produced or pasted — and save it as an artifact. */
export function saveTranscript(
  tenant: TenantContext,
  meetingId: string,
  transcript: MeetingTranscript,
): MeetingRecord {
  const meeting = requireMeeting(tenant, meetingId);
  const markdown = meetingTranscriptToMarkdown(transcript, `${meeting.title} — transcript`);
  const artifactId = persist(tenant, {
    kind: "transcript",
    title: `${meeting.title} — transcript`,
    body: markdown,
    meta: { model: transcript.model, source: transcript.source },
  });
  return meetingStore().update(tenant, meetingId, {
    status: "transcribed",
    transcript,
    transcriptArtifactId: artifactId,
  });
}

async function writeMinutes(
  tenant: TenantContext,
  meeting: MeetingRecord,
  transcript: string,
  locale: AppLocale,
  model: string,
): Promise<MeetingMinutesRecord> {
  const run = await collectJobAssistantRun({
    tenant,
    model,
    systemPrompt: withOutputLanguage(MEETING_MINUTES_SYSTEM, "meeting", locale),
    runPrefix: "meeting-minutes",
    agentId: "meeting",
    jobMode: "meeting",
    versionId: "meeting-minutes",
    prompt: minutesPrompt(transcript, { title: meeting.title }),
    locale,
  });
  const guarded = guardMinutesNames(parseMinutes(run.text), transcript);
  if (guarded.replaced > 0) {
    log.warn("meeting_minutes_names_guarded", { replaced: guarded.replaced });
  }
  return {
    locale,
    minutes: guarded.minutes,
    artifactId: "",
    model: run.model,
    unverifiedNames: guarded.unverified,
  };
}

async function saveMinutesArtifact(
  tenant: TenantContext,
  meeting: MeetingRecord,
  record: MeetingMinutesRecord,
  suffix: string,
): Promise<MeetingMinutesRecord> {
  const markdown = meetingMinutesToMarkdown(record.minutes);
  const title = `${meeting.title} — ${suffix}`;
  const artifactId = persist(tenant, {
    kind: "minutes",
    title,
    body: markdown,
    meta: { model: record.model, locale: record.locale, unverifiedNames: record.unverifiedNames },
  });
  await fileWorkCard(tenant, { artifactId, title, markdown, model: record.model });
  return { ...record, artifactId };
}

/**
 * Transcript → minutes in the meeting's own language, then the same minutes in the other one.
 * Translation is a second model call over the finished JSON rather than a second reading of the
 * transcript, so the two languages cannot disagree about what was decided.
 */
export async function generateMinutes(
  tenant: TenantContext,
  meetingId: string,
  options: { emit?: JobEmitter; abortSignal?: AbortSignal; model?: string; translate?: boolean } = {},
): Promise<MeetingRecord> {
  const emit = options.emit ?? NO_EMIT;
  // Ownership before the runtime gate: a meeting that is not this tenant's is refused the same way
  // whether or not the desk has a key, so a keyless desk cannot be used to probe another tenant's
  // ids, and the tenancy harness reaches this check under the stub runtime.
  const meeting = requireMeeting(tenant, meetingId);
  requireLiveMeetingRuntime(tenant);
  if (!meeting.transcript) {
    throw new ApiError("invalid_request", "Transcribe the recording, or paste a transcript, first", 400);
  }
  const transcript = transcriptPlainText(meeting.transcript);
  if (!transcript) {
    throw new ApiError("invalid_request", "That transcript is empty", 400);
  }
  const model = resolveMeetingModel(options.model, tenant);
  const locale = parseAppLocale(meeting.locale);

  throwIfJobAborted(options.abortSignal);
  emit({ type: "job.phase", phase: "minuting", label: "Writing the minutes" });
  const written = await writeMinutes(tenant, meeting, transcript, locale, model);
  emit({ type: "job.phase", phase: "saving", label: "Saving the minutes" });
  const minutes = await saveMinutesArtifact(tenant, meeting, written, "minutes");
  // On the meeting before the translation starts, so a translation that fails cannot take the
  // minutes with it. An earlier translation described earlier minutes, so it is cleared here.
  const minuted = meetingStore().update(tenant, meetingId, { status: "minuted", minutes, translation: null });
  if (options.translate === false) {
    return minuted;
  }

  throwIfJobAborted(options.abortSignal);
  const target = otherLocale(locale);
  emit({
    type: "job.phase",
    phase: "translating",
    label: `Translating to ${target === "id" ? "Indonesian" : "English"}`,
  });
  const translation = await translateMinutes(tenant, meeting, minutes, target, model);
  return meetingStore().update(tenant, meetingId, { translation });
}

/**
 * The finished minutes in the other language. The guard runs again on the result: a translator
 * that hallucinates a name is exactly as wrong as a writer that does, and the transcript is still
 * the only evidence either of them has.
 */
export async function translateMinutes(
  tenant: TenantContext,
  meeting: MeetingRecord,
  source: MeetingMinutesRecord,
  target: AppLocale,
  model: string,
): Promise<MeetingMinutesRecord> {
  const run = await collectJobAssistantRun({
    tenant,
    model,
    systemPrompt: withOutputLanguage(MEETING_TRANSLATE_SYSTEM, "meeting", target),
    runPrefix: "meeting-translate",
    agentId: "meeting",
    jobMode: "meeting",
    versionId: "meeting-translate",
    prompt: translatePrompt(source.minutes, target),
    locale: target,
  });
  const transcript = meeting.transcript ? transcriptPlainText(meeting.transcript) : "";
  const guarded = guardMinutesNames(parseMinutes(run.text), transcript);
  return saveMinutesArtifact(
    tenant,
    meeting,
    {
      locale: target,
      minutes: guarded.minutes,
      artifactId: "",
      model: run.model,
      unverifiedNames: guarded.unverified,
    },
    target === "id" ? "notulen" : "minutes (English)",
  );
}

/** The whole path in one call, for the studio's single button. */
export async function runMeeting(
  tenant: TenantContext,
  meetingId: string,
  options: { emit?: JobEmitter; abortSignal?: AbortSignal; model?: string; translate?: boolean } = {},
): Promise<MeetingRecord> {
  // Ownership first, as in `generateMinutes` above.
  const meeting = requireMeeting(tenant, meetingId);
  requireLiveMeetingRuntime(tenant);
  if (!meeting.transcript && meeting.recording) {
    await transcribeMeeting(tenant, meetingId, { emit: options.emit, abortSignal: options.abortSignal });
  }
  return generateMinutes(tenant, meetingId, options);
}
