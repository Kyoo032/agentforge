import { z } from "zod";
import type { AspectRatio, EditProject, EditTierName } from "../../edit/document";

export const storyboardShotsSchema = z.union([z.literal(4), z.literal(6)]);

export const generateStoryboardSchema = z
  .object({
    scene: z.string().min(1).max(4000),
    shots: storyboardShotsSchema,
    aspect: z.enum(["16:9", "9:16", "1:1"]),
    tier: z.enum(["draft", "standard", "cinematic"]),
    ingredientIds: z.array(z.string().min(1)).max(8).optional(),
  })
  .strict();

export const animateStoryboardSchema = z
  .object({
    clipIds: z.array(z.string().min(1)).min(1).max(12),
    aspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
    tier: z.enum(["draft", "standard", "cinematic"]).optional(),
  })
  .strict();

export type GenerateStoryboardInput = z.infer<typeof generateStoryboardSchema>;
export type AnimateStoryboardInput = z.infer<typeof animateStoryboardSchema>;

export function splitSceneToShots(scene: string, count: 4 | 6): string[] {
  const lines = scene
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= count) {
    return lines.slice(0, count);
  }
  const padded = [...lines];
  const fallback = lines[0] ?? scene.trim();
  while (padded.length < count) {
    padded.push(fallback);
  }
  if (padded.length > 0) {
    return padded.slice(0, count);
  }
  const words = scene.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return Array.from({ length: count }, () => scene.slice(0, 200));
  }
  const chunk = Math.max(1, Math.ceil(words.length / count));
  return Array.from({ length: count }, (_, index) => {
    const slice = words.slice(index * chunk, (index + 1) * chunk).join(" ");
    return slice || fallback;
  });
}

export function imageAspectForEdit(aspect: AspectRatio): "square" | "landscape" | "portrait" {
  if (aspect === "9:16") {
    return "portrait";
  }
  if (aspect === "1:1") {
    return "square";
  }
  return "landscape";
}

export function timelineTailFrame(project: EditProject, trackId = "v1"): number {
  let end = 0;
  for (const clip of project.clips) {
    if (clip.trackId === trackId) {
      end = Math.max(end, clip.timelineStartFrame + clip.durationFrames);
    }
  }
  return end;
}

export function stillClipDurationFrames(project: EditProject): number {
  return project.fps * 3;
}

export function tierOrDefault(tier?: EditTierName): EditTierName {
  return tier ?? "standard";
}
