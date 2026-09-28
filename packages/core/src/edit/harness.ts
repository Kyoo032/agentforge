/**
 * Method-free Edit skills. The host runs these; the person does not supply frames,
 * thresholds, an ASS style, a model id, or an ffmpeg recipe.
 *
 * Existing stub sentences (S1–S11, F1–F5, "generate image", "generate video") are
 * not skills here. Those stay on the scripted tool path.
 */

export const EDIT_HARNESS_SKILLS = [
  "lift-dead-air",
  "cut-on-shots",
  "words-on-picture",
  "place-made-shot",
  "hand-back-file",
] as const;

export type EditHarnessSkill = (typeof EDIT_HARNESS_SKILLS)[number];

export type HarnessClipSpan = {
  timelineStartFrame: number;
  durationFrames: number;
  source?: { assetId?: string; inFrame: number };
};

export type SilenceRange = { startFrame: number; endFrame: number };

const SKILL_PATTERNS: Array<{ skill: EditHarnessSkill; match: RegExp }> = [
  { skill: "lift-dead-air", match: /dead air|lift the pauses|cut the pauses|buang jeda|hilangkan jeda/i },
  {
    skill: "cut-on-shots",
    match: /where the (?:picture|shot) changes|cut on the shots|potong saat gambar berubah|bagi di pergantian gambar/i,
  },
  { skill: "words-on-picture", match: /words on the picture|tulis(?:kan)? di gambar|teks di gambar/i },
  { skill: "place-made-shot", match: /make a still of|make a clip of|buat gambar|buat klip/i },
  {
    skill: "hand-back-file",
    match: /hand(?: me| back)? the file|export this|ekspor berkas|berikan berkasnya|^\s*export\s*$|^\s*ekspor\s*$/i,
  },
];

export function matchEditHarnessSkill(text: string): EditHarnessSkill | null {
  for (const entry of SKILL_PATTERNS) {
    if (entry.match.test(text)) {
      return entry.skill;
    }
  }
  return null;
}

export function silenceProbeArgs(attempt: number): { noiseDb: number; minSeconds: number } {
  return attempt === 0 ? { noiseDb: -30, minSeconds: 0.6 } : { noiseDb: -45, minSeconds: 0.3 };
}

export function sceneProbeArgs(attempt: number): { threshold: number } {
  return attempt === 0 ? { threshold: 0.4 } : { threshold: 0.2 };
}

export function rangesInsideClip(clip: HarnessClipSpan, ranges: SilenceRange[]): SilenceRange[] {
  const start = clip.timelineStartFrame;
  const end = start + clip.durationFrames;
  return ranges.filter(
    (range) => range.endFrame > range.startFrame && range.startFrame > start && range.endFrame < end,
  );
}

/** Map file-time frames onto the clip, then drop anything that is not strictly inside it. */
export function assetFramesToTimeline(clip: HarnessClipSpan, ranges: SilenceRange[]): SilenceRange[] {
  const inFrame = clip.source?.inFrame ?? 0;
  const mapped = ranges.map((range) => ({
    startFrame: clip.timelineStartFrame + (range.startFrame - inFrame),
    endFrame: clip.timelineStartFrame + (range.endFrame - inFrame),
  }));
  return rangesInsideClip(clip, mapped);
}

export function framesInsideClip(clip: HarnessClipSpan, frames: number[]): number[] {
  const start = clip.timelineStartFrame;
  const end = start + clip.durationFrames;
  return [...new Set(frames)].filter((frame) => frame > start && frame < end).sort((a, b) => a - b);
}

/**
 * Stub stand-in for a local silence probe. Attempt 0 needs a long clip.
 * Attempt 1 is the one retry, on a shorter clip. A tiny clip stays empty.
 */
export function planSilenceRanges(clip: HarnessClipSpan, attempt: number): SilenceRange[] {
  const start = clip.timelineStartFrame;
  const end = start + clip.durationFrames;
  if (attempt <= 0) {
    if (clip.durationFrames < 120) {
      return [];
    }
    const open = start + Math.floor(clip.durationFrames * 0.4);
    const close = start + Math.floor(clip.durationFrames * 0.6);
    return rangesInsideClip(clip, [{ startFrame: open, endFrame: close }]);
  }
  if (attempt === 1 && clip.durationFrames >= 45) {
    const mid = start + Math.floor(clip.durationFrames / 2);
    return rangesInsideClip(clip, [{ startFrame: mid - 5, endFrame: mid + 5 }]).filter(
      (range) => range.startFrame > start && range.endFrame < end,
    );
  }
  return [];
}

/** Stub stand-in for a local scene probe. Same one-retry shape as silence. */
export function planSceneFrames(clip: HarnessClipSpan, attempt: number): number[] {
  const start = clip.timelineStartFrame;
  if (attempt <= 0) {
    if (clip.durationFrames < 180) {
      return [];
    }
    return framesInsideClip(clip, [
      start + Math.floor(clip.durationFrames / 3),
      start + Math.floor((clip.durationFrames * 2) / 3),
    ]);
  }
  if (attempt === 1 && clip.durationFrames >= 60) {
    return framesInsideClip(clip, [start + Math.floor(clip.durationFrames / 2)]);
  }
  return [];
}

export function extractPictureWords(text: string): string | null {
  const quoted = text.match(/[“"]([^”"]+)[”"]/);
  const fromQuotes = quoted?.[1]?.trim();
  if (fromQuotes) {
    return fromQuotes.slice(0, 120);
  }
  const colon = text.split(":").slice(1).join(":").trim();
  if (colon) {
    return colon.slice(0, 120);
  }
  return null;
}

export function pictureWordsAreCaptions(text: string): boolean {
  return /caption|script|naskah|teks overlay/i.test(text);
}

export function wordsLanded(
  clips: Array<{ title?: { text: string }; caption?: { text: string } }>,
  words: string,
  kind: "title" | "caption",
): boolean {
  const needle = words.trim();
  if (!needle) {
    return false;
  }
  return clips.some((clip) =>
    kind === "title" ? clip.title?.text === needle : (clip.caption?.text ?? "").includes(needle),
  );
}

export function extractMadeShot(text: string): { kind: "image" | "video"; prompt: string } | null {
  const clip = text.match(/make a clip of\s+(.+)/i) ?? text.match(/buat klip\s+(.+)/i);
  if (clip?.[1]?.trim()) {
    return { kind: "video", prompt: clip[1].trim().slice(0, 2000) };
  }
  const still = text.match(/make a still of\s+(.+)/i) ?? text.match(/buat gambar\s+(.+)/i);
  if (still?.[1]?.trim()) {
    return { kind: "image", prompt: still[1].trim().slice(0, 2000) };
  }
  return null;
}

export function harnessTargetClip<T extends { trackId: string }>(doc: {
  tracks: Array<{ id: string; kind: string }>;
  clips: T[];
}): T | undefined {
  const video = new Set(doc.tracks.filter((track) => track.kind === "video").map((track) => track.id));
  return doc.clips.find((clip) => video.has(clip.trackId)) ?? doc.clips[0];
}
