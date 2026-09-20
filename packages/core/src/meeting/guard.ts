import {
  meetingMinutesSchema,
  minutesNames,
  NEEDS_OWNER,
  UNVERIFIED_NAME,
  type MeetingMinutes,
} from "./minutes";

export type MinutesGuardResult = {
  minutes: MeetingMinutes;
  /** Names the transcript never said, before they were stamped. */
  unverified: string[];
  replaced: number;
};

/** Markers the writer is allowed to emit; the guard must not second-guess its own stamps. */
const EXEMPT = new Set<string>([NEEDS_OWNER, UNVERIFIED_NAME]);

/** Tokens too short or too common to prove a person was named. */
const SKIP_TOKEN = /^(?:the|and|dan|yang|pak|bu|ibu|bapak|mr|mrs|ms|dr|team|tim)$/i;

function tokens(name: string): string[] {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !SKIP_TOKEN.test(token));
}

/**
 * A name counts as said when the transcript contains one of its word tokens. Deliberately
 * generous: the point is to catch a wholly invented attendee, not to police how a speaker was
 * introduced. A name with no usable token (initials, a single short word) is left alone rather
 * than stamped on no evidence.
 */
export function nameAppearsInTranscript(name: string, transcript: string): boolean {
  const haystack = transcript.toLowerCase();
  const parts = tokens(name);
  if (parts.length === 0) {
    return true;
  }
  return parts.some((token) => haystack.includes(token.toLowerCase()));
}

/**
 * Replace every person the minutes name but the transcript never mentions. Attendees invented by
 * the writer are dropped outright — a minutes sheet that lists someone who was not in the room is
 * worse than a short list. An invented action-item owner becomes `[needs owner]`, because the
 * action itself was still stated.
 */
export function guardMinutesNames(minutes: MeetingMinutes, transcript: string): MinutesGuardResult {
  const unverified = minutesNames(minutes).filter(
    (name) => !EXEMPT.has(name) && !nameAppearsInTranscript(name, transcript),
  );
  if (unverified.length === 0) {
    return { minutes, unverified: [], replaced: 0 };
  }
  const bad = new Set(unverified);
  let replaced = 0;
  const attendees = minutes.attendees.filter((attendee) => {
    if (!bad.has(attendee.name)) {
      return true;
    }
    replaced += 1;
    return false;
  });
  const actionItems = minutes.actionItems.map((item) => {
    if (!bad.has(item.owner)) {
      return item;
    }
    replaced += 1;
    return { ...item, owner: NEEDS_OWNER };
  });
  return {
    minutes: meetingMinutesSchema.parse({ ...minutes, attendees, actionItems }),
    unverified,
    replaced,
  };
}
