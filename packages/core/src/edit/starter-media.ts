import { z } from "zod";
import manifest from "./starter-media.json";

export const STARTER_TRACKS = ["v1", "a1"] as const;
export type StarterTrack = (typeof STARTER_TRACKS)[number];

const generateSchema = z
  .object({
    video: z.string().min(1).optional(),
    videoFilter: z.string().min(1).optional(),
    audio: z.string().min(1).optional(),
    audioFilter: z.string().min(1).optional(),
  })
  .strict();

const starterMediaFileSchema = z
  .object({
    kind: z.enum(["video", "audio"]),
    mime: z.enum(["video/mp4", "audio/mp4"]),
    label: z.string().min(1),
    durationSeconds: z.number().positive(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    hasAudio: z.boolean(),
    generate: generateSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    if (file.kind === "video" && (!file.width || !file.height || !file.fps)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "video files need width, height and fps" });
    }
    if (file.kind === "video" && !file.generate.video) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "video files need generate.video" });
    }
    if (file.kind === "audio" && !file.generate.audio) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "audio files need generate.audio" });
    }
  });

const starterMediaManifestSchema = z
  .object({
    version: z.literal(1),
    files: z.record(z.string().regex(/^[a-z0-9-]+\.(mp4|m4a)$/), starterMediaFileSchema),
  })
  .strict();

export type StarterMediaFile = z.infer<typeof starterMediaFileSchema>;
export type StarterMediaManifest = z.infer<typeof starterMediaManifestSchema>;

/** Bundled sample media shipped with the app. Files live under the desktop `resources/starters` folder. */
export const STARTER_MEDIA: StarterMediaManifest = starterMediaManifestSchema.parse(manifest);

export function starterMediaFile(name: string): StarterMediaFile | undefined {
  return STARTER_MEDIA.files[name];
}

export function starterMediaFileNames(): string[] {
  return Object.keys(STARTER_MEDIA.files);
}

export function starterTrackFor(file: StarterMediaFile): StarterTrack {
  return file.kind === "audio" ? "a1" : "v1";
}
