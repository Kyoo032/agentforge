import type { AppLocale } from "../locale";
import { NEEDS_OWNER, type MeetingMinutes } from "./minutes";

const SHAPE = `{
  "title": string,
  "heldOn": string,
  "summary": string,
  "attendees": [{ "name": string, "role": string }],
  "decisions": [{ "statement": string, "provisional": boolean, "context": string }],
  "actionItems": [{ "task": string, "owner": string, "due": string, "firstStep": string }],
  "risks": [string],
  "openQuestions": [string]
}`;

export const MEETING_MINUTES_SYSTEM = `You write minutes of meeting for DPSBuddy from a transcript.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
${SHAPE}
Rules:
- Work only from the transcript. Never add a decision, a number, a date, or a person that is not in it.
- attendees: only people the transcript names or who plainly speak in it. If nobody is named, return an empty list. Never invent a name, and never guess one from a company or product.
- role: only when the transcript states it. Otherwise "".
- heldOn: only a date the transcript states. Otherwise "". Never today's date.
- decisions: what was actually settled. Set provisional true when the meeting left it open, and say what it depends on in context.
- actionItems: owner is the person who took it on. When nobody took it on, owner is exactly "${NEEDS_OWNER}". due is a date or a relative deadline the transcript states, otherwise "". firstStep is the first concrete move, in one line.
- risks and openQuestions: things that still need a person. One line each, no essays.
- A transcript is speech: fix obvious mis-hearings of a word only when the meaning is unambiguous, and never "fix" a name or a figure.
- No filler. No "the team will follow up". No campus / student / course nouns unless the meeting itself used them.`;

export const MEETING_TRANSLATE_SYSTEM = `You translate minutes of meeting for DPSBuddy.
Return ONLY valid JSON (no markdown fences, no commentary) with the exact same shape you were given:
${SHAPE}
Rules:
- Translate every human-readable value. Keep the JSON keys in English, and keep the boolean as a boolean.
- Keep people's names, company names, product names, figures, currencies, dates, and identifiers exactly as they are. Do not localise a name.
- Keep "${NEEDS_OWNER}" exactly as it is — it is a marker, not a person.
- Keep the same number of items in every list, in the same order. Do not merge, drop, add, or re-order.
- Translate meaning, not word by word. The result must read as though it was written in the target language by the person who ran the meeting.`;

export function minutesPrompt(transcript: string, hints: { title?: string; context?: string } = {}): string {
  return [
    hints.title ? `Meeting: ${hints.title}` : null,
    hints.context ? `What the owner says about this meeting:\n${hints.context}` : null,
    "Transcript:",
    "<<<",
    transcript,
    ">>>",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const LANGUAGE_NAME: Record<AppLocale, string> = { en: "English", id: "Bahasa Indonesia" };

export function translatePrompt(minutes: MeetingMinutes, target: AppLocale): string {
  return [
    `Translate these minutes into ${LANGUAGE_NAME[target]}.`,
    "Minutes JSON:",
    JSON.stringify(minutes, null, 2),
  ].join("\n\n");
}
