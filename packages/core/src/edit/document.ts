import { z } from "zod";
import type { Frame } from "./frames";

export const FPS_VALUES = [24, 25, 30, 60] as const;
export type ProjectFps = (typeof FPS_VALUES)[number];

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const ASPECT_SIZE: Record<AspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export const TRACK_KINDS = ["video", "audio", "caption"] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

export const CLIP_STATUSES = ["ready", "pending", "failed"] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];

export const ASSET_KINDS = ["video", "image", "audio"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export type EditTierName = "draft" | "standard" | "cinematic";

export const TITLE_FONTS = ["Inter", "Noto Sans"] as const;
export type TitleFont = (typeof TITLE_FONTS)[number];

const hex8 = z
  .string()
  .regex(/^#[0-9A-Fa-f]{8}$/, "expected #RRGGBBAA")
  .describe("hex8 #RRGGBBAA");

export const titleBoxSchema = z
  .object({
    color: hex8,
  })
  .strict();

/** ASS-expressible subset only (G-11). Unknown keys (gradients, blur, letter-spacing) are rejected. */
export const titleStyleSchema = z
  .object({
    fontFamily: z.enum(TITLE_FONTS),
    fontSizePx: z.number().int().min(12).max(200),
    primaryColor: hex8,
    outlineColor: hex8,
    outlinePx: z.number().int().min(0).max(8),
    shadowPx: z.number().int().min(0).max(8),
    bold: z.boolean(),
    italic: z.boolean(),
    alignment: z.number().int().min(1).max(9),
    marginL: z.number().int().min(0).max(4096),
    marginR: z.number().int().min(0).max(4096),
    marginV: z.number().int().min(0).max(4096),
    box: titleBoxSchema.optional(),
  })
  .strict();

export type TitleStyle = z.infer<typeof titleStyleSchema>;

export const DEFAULT_TITLE_STYLE: TitleStyle = {
  fontFamily: "Inter",
  fontSizePx: 48,
  primaryColor: "#FFFFFFFF",
  outlineColor: "#000000FF",
  outlinePx: 2,
  shadowPx: 0,
  bold: false,
  italic: false,
  alignment: 8,
  marginL: 80,
  marginR: 80,
  marginV: 40,
};

export const DEFAULT_CAPTION_STYLE: TitleStyle = {
  ...DEFAULT_TITLE_STYLE,
  fontSizePx: 36,
  alignment: 2,
  marginV: 64,
};

export const lineageSchema = z
  .object({
    parentClipId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    prompt: z.string().optional(),
    model: z.string().optional(),
    tier: z.enum(["draft", "standard", "cinematic"]).optional(),
    seed: z.number().int().optional(),
    ingredientIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type Lineage = z.infer<typeof lineageSchema>;

export const trackSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(TRACK_KINDS),
    name: z.string().min(1),
    muted: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();

export type Track = z.infer<typeof trackSchema>;

export const clipSourceSchema = z
  .object({
    assetId: z.string().min(1),
    inFrame: z.number().int().nonnegative(),
  })
  .strict();

export const clipSchema = z
  .object({
    id: z.string().min(1),
    trackId: z.string().min(1),
    timelineStartFrame: z.number().int().nonnegative(),
    durationFrames: z.number().int().min(1),
    source: clipSourceSchema.optional(),
    status: z.enum(CLIP_STATUSES),
    fallbackAssetId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    title: z
      .object({
        text: z.string().max(120),
        style: titleStyleSchema,
      })
      .strict()
      .optional(),
    caption: z
      .object({
        text: z.string().max(500),
      })
      .strict()
      .optional(),
    volume: z.number().min(0).max(2).optional(),
    lineage: lineageSchema.optional(),
    badge: z
      .object({
        cardId: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Clip = z.infer<typeof clipSchema>;

const relativeStoragePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.startsWith("\\") && !value.includes("..") && !/^[A-Za-z]:/.test(value), {
    message: "storagePath must be relative to mediaRoot()",
  });

export const assetSchema = z
  .object({
    id: z.string().min(1),
    mediaId: z.string().min(1).optional(),
    kind: z.enum(ASSET_KINDS),
    storagePath: relativeStoragePath,
    durationFrames: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    fps: z.number().positive().optional(),
    hasAudio: z.boolean().optional(),
    probe: z
      .object({
        codec: z.string().optional(),
        sampleRate: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type Asset = z.infer<typeof assetSchema>;

export const ingredientSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    assetId: z.string().min(1).optional(),
    text: z.string().optional(),
  })
  .strict();

export type Ingredient = z.infer<typeof ingredientSchema>;

export const reviewStateSchema = z
  .object({
    lastAgentSeq: z.number().int().nonnegative(),
    ackSeq: z.number().int().nonnegative(),
  })
  .strict();

export const projectSchema = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    tracks: z.array(trackSchema),
    clips: z.array(clipSchema),
    assets: z.record(z.string(), assetSchema),
    ingredients: z.array(ingredientSchema),
    review: reviewStateSchema,
    seq: z.number().int().nonnegative(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export type EditProject = z.infer<typeof projectSchema>;

export type AssetId = string;
export type ClipId = string;
export type TrackId = string;
export type { Frame };

export function emptyProject(input: {
  id: string;
  workspaceId: string;
  name: string;
  aspect: AspectRatio;
  fps?: ProjectFps;
}): EditProject {
  const now = new Date().toISOString();
  const size = ASPECT_SIZE[input.aspect];
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    name: input.name,
    fps: input.fps ?? 30,
    width: size.width,
    height: size.height,
    tracks: [
      { id: "v1", kind: "video", name: "V1" },
      { id: "a1", kind: "audio", name: "A1" },
      { id: "c1", kind: "caption", name: "C1" },
    ],
    clips: [],
    assets: {},
    ingredients: [],
    review: { lastAgentSeq: 0, ackSeq: 0 },
    seq: 0,
    createdAt: now,
    updatedAt: now,
  };
}
