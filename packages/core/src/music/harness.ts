/**
 * Music harness for a person who brings one sentence and no method.
 *
 * Phases: brief, words, name, takes. A check or a retry exists only for the
 * skill that needs it. Speech is not a phase.
 */

import { APP_LOCALES } from "../locale";
import { MUSIC_LYRICS_MAX, MUSIC_TITLE_MAX } from "../models/audio-capabilities";
import { outputLanguageRule } from "../output-language";

export const MUSIC_HARNESS_SKILLS = [
  { id: "hear-sentence", name: "Hear one sentence", status: "has" },
  { id: "desk-language", name: "Write the words in their language", status: "has" },
  { id: "shape-lyric", name: "Shape a lyric they can sing", status: "new" },
  { id: "name-song", name: "Name the song", status: "new" },
  { id: "both-takes", name: "Bring both takes home", status: "new" },
] as const;

export type MusicHarnessSkillId = (typeof MUSIC_HARNESS_SKILLS)[number]["id"];

/** One automatic retry, then the existing error. */
export const MUSIC_HARNESS_ATTEMPTS = 2;

const SECTION_LABEL =
  /^(verse|chorus|bridge|intro|outro|hook|pre-chorus|interlude|reff|reffrain|refrein|bait)(\s*\d+)?\s*[:.-]*$/i;

/** Drop the music language instruction if a draft echoed it. Lyrics that never contained it come back unchanged. */
export function stripMusicLanguageRule(text: string): string {
  let next = text;
  let removed = false;
  for (const locale of APP_LOCALES) {
    const rule = outputLanguageRule("music", locale);
    if (next.includes(rule)) {
      next = next.split(rule).join("");
      removed = true;
    }
  }
  return removed ? next.trim() : next;
}

function isSectionLabel(line: string): boolean {
  return SECTION_LABEL.test(line.trim());
}

/** Lines that can be sung: not blank, not a section label, and not the language instruction. */
export function singableLines(text: string): string[] {
  return stripMusicLanguageRule(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isSectionLabel(line));
}

/** Skill: shape a lyric they can sing. Two sung lines, inside the lyrics cap. */
export function lyricsAreSingable(text: string): boolean {
  const lines = singableLines(text);
  return lines.length >= 2 && lines.join("\n").length <= MUSIC_LYRICS_MAX;
}

/**
 * Skill: shape a lyric. A draft that is not singable is tried once more.
 * `draftsSoFar` is how many drafts are already in hand.
 */
export function shouldRetryLyrics(draftsSoFar: number, text: string): boolean {
  return draftsSoFar < MUSIC_HARNESS_ATTEMPTS && !lyricsAreSingable(text);
}

/** Keep the singable draft. When neither is singable, keep the longer one so the box still fills. */
export function preferLyricDraft(current: string, next: string): string {
  const first = stripMusicLanguageRule(current).trim();
  const second = stripMusicLanguageRule(next).trim();
  const firstOk = lyricsAreSingable(first);
  const secondOk = lyricsAreSingable(second);
  if (secondOk && !firstOk) {
    return second;
  }
  if (firstOk && !secondOk) {
    return first;
  }
  return second.length > first.length ? second : first;
}

/** Skill: name the song. First sung line of the brief, clipped to the title cap. */
export function songTitleFromBrief(brief: string): string | undefined {
  const line = singableLines(brief)[0];
  if (!line) {
    return undefined;
  }
  const stop = line.search(/[.!?]/);
  const sentence = (stop === -1 ? line : line.slice(0, stop)).replace(/\s+/g, " ").trim();
  const title = sentence.slice(0, MUSIC_TITLE_MAX).trim();
  return title || undefined;
}

/**
 * A title they typed wins, then a title on the take, then one drawn from the brief.
 */
export function resolveSongTitle(options: {
  ownerTitle?: string;
  takeTitle?: string;
  brief: string;
}): string | undefined {
  const owner = options.ownerTitle?.trim();
  if (owner) {
    return owner.slice(0, MUSIC_TITLE_MAX);
  }
  const take = options.takeTitle?.trim();
  if (take) {
    return take.slice(0, MUSIC_TITLE_MAX);
  }
  return songTitleFromBrief(options.brief);
}

/**
 * Skill: bring both takes home. No tracks means one more submit of the same brief.
 * `attemptsSoFar` counts submits already made.
 */
export function shouldRetryMusicJob(attemptsSoFar: number, trackCount: number): boolean {
  return trackCount === 0 && attemptsSoFar < MUSIC_HARNESS_ATTEMPTS;
}
