import { z } from "zod";
import { APP_LOCALES } from "@agentforge/core";
import { meetingMinutesSchema } from "@agentforge/core/meeting";
import { meetingTranscriptSchema } from "@agentforge/core/meeting";

export const meetingRecordingSchema = z.object({
  /** The uploader's filename, sanitised. */
  name: z.string().min(1),
  /** Relative to the meeting directory, e.g. `recording/source.mp3`. */
  path: z.string().min(1),
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().min(1),
  /** ffprobe's reading, when ffmpeg was available to take one. */
  durationSeconds: z.number().nonnegative().optional(),
});

/** Minutes in one language, with the artifact they were saved as. */
export const meetingMinutesRecordSchema = z.object({
  locale: z.enum(APP_LOCALES),
  minutes: meetingMinutesSchema,
  artifactId: z.string().default(""),
  model: z.string().default(""),
  /** Names the writer asserted that the transcript never said; stamped out by the guard. */
  unverifiedNames: z.array(z.string()).default([]),
});

export const MEETING_STATUSES = ["new", "recorded", "transcribed", "minuted"] as const;

export const meetingRecordSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string().min(1),
  /** The language the minutes are written in first. The translation is the other one. */
  locale: z.enum(APP_LOCALES),
  status: z.enum(MEETING_STATUSES).default("new"),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  recording: meetingRecordingSchema.nullable().default(null),
  transcript: meetingTranscriptSchema.nullable().default(null),
  transcriptArtifactId: z.string().default(""),
  minutes: meetingMinutesRecordSchema.nullable().default(null),
  /** The same minutes in the other app locale. */
  translation: meetingMinutesRecordSchema.nullable().default(null),
});

export type MeetingRecording = z.infer<typeof meetingRecordingSchema>;
export type MeetingMinutesRecord = z.infer<typeof meetingMinutesRecordSchema>;
export type MeetingRecord = z.infer<typeof meetingRecordSchema>;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
