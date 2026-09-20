import { z } from "zod";

export const transcriptSegmentSchema = z.object({
  /** Offset from the start of the recording, in seconds. Absent when the backend gave no timings. */
  startSeconds: z.number().nonnegative().optional(),
  /** As the transcript labelled the voice, when it labelled one at all. */
  speaker: z.string().default(""),
  text: z.string().min(1),
});

export const meetingTranscriptSchema = z.object({
  text: z.string().default(""),
  segments: z.array(transcriptSegmentSchema).default([]),
  /** BCP-47-ish hint the caller passed to the backend, e.g. "en" or "id". Empty means auto. */
  language: z.string().default(""),
  /** How the text was produced, so the UI can say "typed" rather than imply a machine heard it. */
  source: z.enum(["gateway", "pasted"]).default("pasted"),
  model: z.string().default(""),
});

export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type MeetingTranscript = z.infer<typeof meetingTranscriptSchema>;

export const TRANSCRIPT_MAX_CHARS = 600_000;

function stamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor((whole % 3600) / 60);
  const ss = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
}

export function transcriptSegmentLine(segment: TranscriptSegment): string {
  const time = segment.startSeconds === undefined ? "" : `[${stamp(segment.startSeconds)}] `;
  const speaker = segment.speaker.trim() ? `**${segment.speaker.trim()}:** ` : "";
  return `${time}${speaker}${segment.text.trim()}`;
}

export function meetingTranscriptToMarkdown(transcript: MeetingTranscript, title: string): string {
  const body =
    transcript.segments.length > 0
      ? transcript.segments.map(transcriptSegmentLine).join("\n\n")
      : transcript.text.trim();
  return `${[`# ${title}`, "", body].join("\n").trim()}\n`;
}

/** The plain text a minutes writer or a guard reads, whichever shape the transcript arrived in. */
export function transcriptPlainText(transcript: MeetingTranscript): string {
  if (transcript.text.trim()) {
    return transcript.text.trim();
  }
  return transcript.segments
    .map((segment) => (segment.speaker.trim() ? `${segment.speaker.trim()}: ${segment.text}` : segment.text))
    .join("\n")
    .trim();
}
