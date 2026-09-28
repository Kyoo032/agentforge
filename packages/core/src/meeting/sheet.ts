import { parseAppLocale, type AppLocale } from "../locale";
import { minutesAgree } from "./agree";
import { emptyMinutesMessage, invalidMinutesMessage, minutesShapeRetryNote, translationRetryNote } from "./copy";
import { guardMinutesGrounding } from "./ground";
import { guardMinutesNames } from "./guard";
import { meetingMinutesSchema, type MeetingMinutes } from "./minutes";
import { minutesPrompt, translatePrompt } from "./prompts";

export class MeetingSheetError extends Error {
  readonly code: "invalid_minutes" | "generation_failed";

  constructor(code: "invalid_minutes" | "generation_failed", message: string) {
    super(message);
    this.name = "MeetingSheetError";
    this.code = code;
  }
}

/** The other language still disagrees after its one retry. The minutes themselves are already settled. */
export class MeetingTranslationError extends Error {
  readonly code = "translation_disagreed" as const;

  constructor() {
    super("translation_disagreed");
    this.name = "MeetingTranslationError";
  }
}

export type SettledMinutes = {
  minutes: MeetingMinutes;
  unverifiedNames: string[];
  replacedNames: number;
  clearedDates: number;
  replacedFigures: number;
};

function jsonObject(raw: string): string {
  let trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced?.[1]) {
    trimmed = fenced[1].trim();
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no object");
  }
  return trimmed.slice(start, end + 1);
}

/** Parse one model answer into the minutes sheet. A prose answer or the wrong shape throws. */
export function parseMeetingMinutes(raw: string, locale: AppLocale): MeetingMinutes {
  const lang = parseAppLocale(locale);
  if (!raw.trim()) {
    throw new MeetingSheetError("generation_failed", emptyMinutesMessage(lang));
  }
  let jsonText: string;
  try {
    jsonText = jsonObject(raw);
  } catch {
    throw new MeetingSheetError("invalid_minutes", invalidMinutesMessage(lang));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new MeetingSheetError("invalid_minutes", invalidMinutesMessage(lang));
  }
  const result = meetingMinutesSchema.safeParse(parsed);
  if (!result.success) {
    throw new MeetingSheetError("invalid_minutes", invalidMinutesMessage(lang));
  }
  return result.data;
}

/** Names, then dates and figures. Both guards are code. Neither calls the model. */
export function settleMinutes(raw: string, transcript: string, locale: AppLocale): SettledMinutes {
  const named = guardMinutesNames(parseMeetingMinutes(raw, locale), transcript);
  const grounded = guardMinutesGrounding(named.minutes, transcript);
  return {
    minutes: grounded.minutes,
    unverifiedNames: named.unverified,
    replacedNames: named.replaced,
    clearedDates: grounded.clearedDates,
    replacedFigures: grounded.replacedFigures,
  };
}

function acceptTranslation(
  raw: string,
  transcript: string,
  source: MeetingMinutes,
  locale: AppLocale,
): SettledMinutes | null {
  let settled: SettledMinutes;
  try {
    settled = settleMinutes(raw, transcript, locale);
  } catch (error) {
    if (error instanceof MeetingSheetError) {
      return null;
    }
    throw error;
  }
  if (!minutesAgree(source, settled.minutes).ok) {
    return null;
  }
  return settled;
}

/**
 * One write of the minutes sheet, and a second only when the first answer is not that sheet.
 * The name guard and the date/figure guard run on the answer that parsed. They do not retry.
 */
export async function writeMeetingSheet(input: {
  transcript: string;
  title: string;
  locale: AppLocale;
  ask: (prompt: string) => Promise<string>;
  onAttempt?: (attempt: 1 | 2) => void;
  onGrounded?: (settled: SettledMinutes) => void;
}): Promise<SettledMinutes> {
  const locale = parseAppLocale(input.locale);
  const prompt = minutesPrompt(input.transcript, { title: input.title });
  input.onAttempt?.(1);
  let settled: SettledMinutes;
  try {
    settled = settleMinutes(await input.ask(prompt), input.transcript, locale);
  } catch (error) {
    if (!(error instanceof MeetingSheetError)) {
      throw error;
    }
    input.onAttempt?.(2);
    settled = settleMinutes(await input.ask(`${prompt}\n\n${minutesShapeRetryNote(locale)}`), input.transcript, locale);
  }
  input.onGrounded?.(settled);
  return settled;
}

/**
 * One translation of the settled sheet, and a second only when the first is not the same sheet.
 * A network failure is not retried. After the second miss the minutes stay and the translation does not.
 */
export async function translateMeetingSheet(input: {
  transcript: string;
  source: MeetingMinutes;
  locale: AppLocale;
  ask: (prompt: string) => Promise<string>;
  onAttempt?: (attempt: 1 | 2) => void;
}): Promise<SettledMinutes> {
  const locale = parseAppLocale(input.locale);
  const prompt = translatePrompt(input.source, locale);
  input.onAttempt?.(1);
  const first = acceptTranslation(await input.ask(prompt), input.transcript, input.source, locale);
  if (first) {
    return first;
  }
  input.onAttempt?.(2);
  const settled = settleMinutes(
    await input.ask(`${prompt}\n\n${translationRetryNote(locale)}`),
    input.transcript,
    locale,
  );
  if (!minutesAgree(input.source, settled.minutes).ok) {
    throw new MeetingTranslationError();
  }
  return settled;
}
