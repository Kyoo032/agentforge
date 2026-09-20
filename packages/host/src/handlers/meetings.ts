import { ApiError, isAppLocale, parseAppLocale, type AppLocale } from "@agentforge/core";
import { TRANSCRIPT_MAX_CHARS, meetingTranscriptSchema } from "@agentforge/core/meeting";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { requireGatewayAllowed } from "../gateway-gate";
import { streamJob } from "../job-stream";
import { generateMinutes, runMeeting, saveTranscript, transcribeMeeting } from "../meeting/run";
import { meetingStore, requireMeeting } from "../meeting/store";
import { resolveMeetingAsr } from "../meeting/transcribe";
import { ffmpegAvailable } from "../meeting/audio";
import { localeForRun } from "../run-context";
import { loadSettings } from "../settings-store";
import { getTenant } from "../tenant";

function body(request: HostRequest): Record<string, unknown> {
  const value = request.body;
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  return value as Record<string, unknown>;
}

function readLocale(value: unknown, fallback: AppLocale): AppLocale {
  return isAppLocale(value) ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function handleGetMeetings(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk({
      items: meetingStore().list(tenant),
      // What this desk can actually do right now, so the studio can say "paste the transcript"
      // before the owner uploads 25 MB and finds out.
      capability: { ...resolveMeetingAsr(tenant.workspaceId), ffmpeg: ffmpegAvailable() },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostMeetings(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const input = body(request);
    const title = readOptionalString(input.title);
    if (!title) {
      throw new ApiError("invalid_request", "title is required", 400);
    }
    const meeting = meetingStore().create(tenant, {
      title,
      locale: readLocale(input.locale, parseAppLocale(localeForRun())),
    });
    return jsonOk(meeting, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetMeeting(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(requireMeeting(tenant, request.params.meetingId ?? ""));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteMeeting(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const removed = meetingStore().remove(tenant, request.params.meetingId ?? "");
    if (!removed) {
      throw new ApiError("not_found", "Meeting not found", 404);
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * The recording itself. Deliberately not behind the gateway gate: an owner with no key can still
 * upload and keep a recording, exactly as Legal lets a matter be assembled before a run.
 */
export async function handlePostMeetingRecording(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
    if (!file) {
      throw new ApiError("invalid_content_part", "file is required", 400);
    }
    const meeting = meetingStore().addRecording(tenant, request.params.meetingId ?? "", {
      filename: file.filename,
      mime: file.mime,
      bytes: file.bytes,
    });
    return jsonOk(meeting, 201);
  } catch (error) {
    return jsonError(error);
  }
}

/** A transcript the owner already has. No gateway involved, so no gate. */
export async function handlePostMeetingTranscript(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const meetingId = request.params.meetingId ?? "";
    const input = body(request);
    const text = typeof input.text === "string" ? input.text.trim() : "";
    if (!text) {
      throw new ApiError("invalid_request", "text is required", 400);
    }
    if (text.length > TRANSCRIPT_MAX_CHARS) {
      throw new ApiError("invalid_request", `A transcript is capped at ${TRANSCRIPT_MAX_CHARS} characters`, 413);
    }
    const transcript = meetingTranscriptSchema.parse({
      text,
      segments: [],
      language: readOptionalString(input.language) ?? "",
      source: "pasted",
      model: "",
    });
    return jsonOk(saveTranscript(tenant, meetingId, transcript));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostMeetingTranscribe(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    const meetingId = request.params.meetingId ?? "";
    const language = readOptionalString(body(request).language);
    return streamJob(
      (emit, abortSignal) => transcribeMeeting(tenant, meetingId, { emit, abortSignal, language }),
      { abortSignal: request.abortSignal },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostMeetingMinutes(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    const meetingId = request.params.meetingId ?? "";
    const input = body(request);
    const model = readOptionalString(input.model);
    const translate = input.translate !== false;
    return streamJob(
      (emit, abortSignal) => generateMinutes(tenant, meetingId, { emit, abortSignal, model, translate }),
      { abortSignal: request.abortSignal },
    );
  } catch (error) {
    return jsonError(error);
  }
}

/** Upload to minutes in one stream: what the studio's single button calls. */
export async function handlePostMeetingRunStream(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowed(loadSettings(tenant.workspaceId));
    const meetingId = request.params.meetingId ?? "";
    const input = body(request);
    const model = readOptionalString(input.model);
    const translate = input.translate !== false;
    return streamJob(
      (emit, abortSignal) => runMeeting(tenant, meetingId, { emit, abortSignal, model, translate }),
      { abortSignal: request.abortSignal },
    );
  } catch (error) {
    return jsonError(error);
  }
}
