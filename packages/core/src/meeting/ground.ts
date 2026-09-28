import { meetingMinutesSchema, type MeetingMinutes } from "./minutes";

/** Stamped over a number the transcript never said. A marker, not a figure. */
export const FIGURE_NOT_SAID = "[figure not said]";

const FIGURE = /\d+(?:[.,]\d+)*%?/g;

export type GroundingResult = {
  minutes: MeetingMinutes;
  /** Non-empty date fields cleared because the transcript never said them. */
  clearedDates: number;
  /** Number tokens replaced with `FIGURE_NOT_SAID`. */
  replacedFigures: number;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The numeric core, so `2.1` and `2,1` are the same figure and a trailing `%` is not part of it. */
function figureCores(token: string): string[] {
  const bare = token.replace(/%$/, "");
  const cores = new Set<string>([bare]);
  if (/^\d+[.,]\d+$/.test(bare)) {
    cores.add(bare.includes(",") ? bare.replace(",", ".") : bare.replace(".", ","));
  }
  return [...cores];
}

/** A figure counts as said only as its own number, so `12` is not found inside `120`. */
export function figureSaid(token: string, transcript: string): boolean {
  return figureCores(token).some((core) => new RegExp(`(?<!\\d)${escapeRegExp(core)}(?!\\d)`).test(transcript));
}

/** A date claim counts as said only when that whole phrase is in the transcript. */
export function dateSaid(claim: string, transcript: string): boolean {
  const needle = claim.trim().replace(/\s+/g, " ").toLowerCase();
  if (!needle) {
    return true;
  }
  return transcript.replace(/\s+/g, " ").toLowerCase().includes(needle);
}

/** Every figure mark in a string, markers included, so two sheets can be compared. */
export function figureMarks(text: string): string[] {
  const marks: string[] = [];
  const markers = text.split(FIGURE_NOT_SAID).length - 1;
  for (let index = 0; index < markers; index += 1) {
    marks.push(FIGURE_NOT_SAID);
  }
  for (const match of text.matchAll(FIGURE)) {
    const [core] = figureCores(match[0]);
    if (core) {
      marks.push(core.includes(",") ? core.replace(",", ".") : core);
    }
  }
  return marks;
}

function replaceFigures(text: string, transcript: string): { text: string; replaced: number } {
  let replaced = 0;
  const next = text.replace(FIGURE, (token) => {
    if (figureSaid(token, transcript)) {
      return token;
    }
    replaced += 1;
    return FIGURE_NOT_SAID;
  });
  return { text: next.replace(/[ \t]{2,}/g, " ").trim(), replaced };
}

/**
 * Clear a date the transcript never said, and replace a figure it never said. Names are not this
 * function's job. Nothing here asks the model to try again.
 */
export function guardMinutesGrounding(minutes: MeetingMinutes, transcript: string): GroundingResult {
  let clearedDates = 0;
  let replacedFigures = 0;
  const rewrite = (text: string): string => {
    const result = replaceFigures(text, transcript);
    replacedFigures += result.replaced;
    return result.text;
  };
  const heldOn = dateSaid(minutes.heldOn, transcript) ? minutes.heldOn : "";
  if (minutes.heldOn.trim() && !heldOn) {
    clearedDates += 1;
  }
  const attendees = minutes.attendees.map((attendee) => ({ ...attendee, role: rewrite(attendee.role) }));
  const decisions = minutes.decisions.map((decision) => ({
    ...decision,
    statement: rewrite(decision.statement),
    context: rewrite(decision.context),
  }));
  const actionItems = minutes.actionItems.map((item) => {
    const due = dateSaid(item.due, transcript) ? item.due : "";
    if (item.due.trim() && !due) {
      clearedDates += 1;
    }
    return { ...item, task: rewrite(item.task), firstStep: rewrite(item.firstStep), due };
  });
  return {
    minutes: meetingMinutesSchema.parse({
      ...minutes,
      heldOn,
      summary: rewrite(minutes.summary),
      attendees,
      decisions,
      actionItems,
      risks: minutes.risks.map(rewrite),
      openQuestions: minutes.openQuestions.map(rewrite),
    }),
    clearedDates,
    replacedFigures,
  };
}
