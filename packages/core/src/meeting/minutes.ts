import { z } from "zod";
import { markdownTable } from "../artifacts/markdown-table";

/** A person the transcript actually named. `role` is only set when the meeting stated one. */
export const meetingAttendeeSchema = z.object({
  name: z.string().min(1),
  role: z.string().default(""),
});

export const meetingDecisionSchema = z.object({
  statement: z.string().min(1),
  /** "provisional" when the meeting did not settle it; the writer must say so rather than imply finality. */
  provisional: z.boolean().default(false),
  context: z.string().default(""),
});

export const meetingActionItemSchema = z.object({
  task: z.string().min(1),
  /** `NEEDS_OWNER` when nobody was named — never a guess. */
  owner: z.string().min(1),
  due: z.string().default(""),
  firstStep: z.string().default(""),
});

export const meetingMinutesSchema = z.object({
  title: z.string().min(1),
  /** As stated in the meeting; empty when nobody said a date. Never today's date. */
  heldOn: z.string().default(""),
  summary: z.string().min(1),
  attendees: z.array(meetingAttendeeSchema).default([]),
  decisions: z.array(meetingDecisionSchema).default([]),
  actionItems: z.array(meetingActionItemSchema).default([]),
  risks: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
});

export type MeetingAttendee = z.infer<typeof meetingAttendeeSchema>;
export type MeetingDecision = z.infer<typeof meetingDecisionSchema>;
export type MeetingActionItem = z.infer<typeof meetingActionItemSchema>;
export type MeetingMinutes = z.infer<typeof meetingMinutesSchema>;

/** Stamped in place of an owner the meeting never named. The writer must not invent one. */
export const NEEDS_OWNER = "[needs owner]";
/** Stamped by `guardMinutesNames` over a person the transcript never mentions. */
export const UNVERIFIED_NAME = "[unverified name]";

function listBlock(heading: string, items: string[]): string[] {
  if (items.length === 0) {
    return [];
  }
  return [`## ${heading}`, "", ...items.map((item) => `- ${item}`), ""];
}

function decisionLine(decision: MeetingDecision): string {
  const provisional = decision.provisional ? " *(provisional)*" : "";
  const context = decision.context.trim() ? ` — ${decision.context.trim()}` : "";
  return `${decision.statement}${provisional}${context}`;
}

function attendeeLine(attendee: MeetingAttendee): string {
  const role = attendee.role.trim();
  return role ? `${attendee.name} — ${role}` : attendee.name;
}

export function meetingMinutesToMarkdown(minutes: MeetingMinutes): string {
  const lines = [`# ${minutes.title}`, ""];
  if (minutes.heldOn.trim()) {
    lines.push(`*${minutes.heldOn.trim()}*`, "");
  }
  lines.push(minutes.summary.trim(), "");
  lines.push(...listBlock("Attendees", minutes.attendees.map(attendeeLine)));
  lines.push(...listBlock("Decisions", minutes.decisions.map(decisionLine)));
  if (minutes.actionItems.length > 0) {
    const rows = minutes.actionItems.map((item) => [
      item.task,
      item.owner,
      item.due.trim() || "—",
      item.firstStep.trim() || "—",
    ]);
    lines.push("## Action items", "", markdownTable(["Action", "Owner", "Due", "First step"], rows), "");
  }
  lines.push(...listBlock("Risks and blockers", minutes.risks));
  lines.push(...listBlock("Open questions", minutes.openQuestions));
  return `${lines.join("\n").trim()}\n`;
}

/** Every name the minutes assert, in one list, so a guard can check them against the transcript. */
export function minutesNames(minutes: MeetingMinutes): string[] {
  const names = new Set<string>();
  for (const attendee of minutes.attendees) {
    names.add(attendee.name);
  }
  for (const item of minutes.actionItems) {
    names.add(item.owner);
  }
  return [...names];
}
