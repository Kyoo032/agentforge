import { figureMarks } from "./ground";
import type { MeetingMinutes } from "./minutes";

export type MinutesAgreeReason = "counts" | "owners" | "dates" | "provisional" | "figures";

export type MinutesAgreeResult = { ok: true } | { ok: false; reason: MinutesAgreeReason };

function same(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function prose(minutes: MeetingMinutes): string[] {
  return [
    minutes.summary,
    ...minutes.decisions.map((decision) => `${decision.statement}\n${decision.context}`),
    ...minutes.actionItems.map((item) => `${item.task}\n${item.firstStep}`),
    ...minutes.risks,
    ...minutes.openQuestions,
    ...minutes.attendees.map((attendee) => attendee.role),
  ];
}

/**
 * The translation is the same sheet when the lists, owners, dates, provisional marks, and figures
 * still line up. Wording may change. A dropped decision, a renamed owner, or a new number may not.
 */
export function minutesAgree(source: MeetingMinutes, translated: MeetingMinutes): MinutesAgreeResult {
  const countsMatch =
    source.attendees.length === translated.attendees.length &&
    source.decisions.length === translated.decisions.length &&
    source.actionItems.length === translated.actionItems.length &&
    source.risks.length === translated.risks.length &&
    source.openQuestions.length === translated.openQuestions.length;
  if (!countsMatch) {
    return { ok: false, reason: "counts" };
  }
  const ownersMatch =
    same(
      source.attendees.map((attendee) => attendee.name),
      translated.attendees.map((attendee) => attendee.name),
    ) &&
    same(
      source.actionItems.map((item) => item.owner),
      translated.actionItems.map((item) => item.owner),
    );
  if (!ownersMatch) {
    return { ok: false, reason: "owners" };
  }
  const datesMatch =
    source.heldOn === translated.heldOn &&
    same(
      source.actionItems.map((item) => item.due),
      translated.actionItems.map((item) => item.due),
    );
  if (!datesMatch) {
    return { ok: false, reason: "dates" };
  }
  const provisionalMatch = same(
    source.decisions.map((decision) => (decision.provisional ? "1" : "0")),
    translated.decisions.map((decision) => (decision.provisional ? "1" : "0")),
  );
  if (!provisionalMatch) {
    return { ok: false, reason: "provisional" };
  }
  const sourceFigures = prose(source).flatMap(figureMarks).sort();
  const translatedFigures = prose(translated).flatMap(figureMarks).sort();
  if (!same(sourceFigures, translatedFigures)) {
    return { ok: false, reason: "figures" };
  }
  return { ok: true };
}
