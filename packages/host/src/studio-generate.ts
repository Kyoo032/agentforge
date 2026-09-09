import { z } from "zod";
import {
  ApiError,
  buildToolSecretScope,
  imageGenerateTool,
  listToolRoutes,
  maskPii,
  mediaKind,
  pickPreferredImageModel,
  pickPreferredVideoModel,
  runWithToolSecrets,
  studioVideoFailureStatus,
  videoCapabilities,
  snapVideoSeconds,
  videoGenerateTool,
  type ChatModel,
  type TenantContext,
} from "@agentforge/core";
import { loadSettings } from "./settings-store";
import { listImageModels, listVideoModels } from "./selectable-models";
import { mediaIdFromUrl } from "./media-id";
import { getStudioMediaMeta, saveStudioMediaMeta, type StudioMediaMeta } from "./studio-media-meta";

export const imageGenerateBodySchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required"),
  aspect: z.enum(["square", "landscape", "portrait"]).optional().default("square"),
  model: z.string().trim().min(1).optional(),
  imageUrl: z.string().url().optional(),
});

export const videoGenerateBodySchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required"),
  aspect: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
  model: z.string().trim().min(1).optional(),
  imageUrl: z.string().url().optional(),
  seconds: z.number().int().min(2).max(12).optional(),
  resolution: z.enum(["480p", "720p", "1080p"]).optional(),
});

export type ImageGenerateBody = z.infer<typeof imageGenerateBodySchema>;
export type VideoGenerateBody = z.infer<typeof videoGenerateBodySchema>;

export type StudioGalleryItem = {
  id: string;
  url: string;
  mime: string;
  createdAt: string;
  prompt?: string;
  aspect?: string;
  model?: string;
};

export type StudioGenerateResult = {
  id: string | null;
  url: string;
  prompt: string;
  aspect: string;
  model: string;
};

export function listStudioImageModels(models: ChatModel[] = listImageModels()): ChatModel[] {
  return models.filter((model) => mediaKind(model.id) === "image");
}

export function listStudioVideoModels(models: ChatModel[] = listVideoModels()): ChatModel[] {
  return models.filter((model) => mediaKind(model.id) === "video");
}

export function defaultStudioImageModel(models: ChatModel[] = listStudioImageModels()): string {
  return pickPreferredImageModel(models.map((model) => model.id));
}

export function defaultStudioVideoModel(models: ChatModel[] = listStudioVideoModels()): string {
  return pickPreferredVideoModel(models.map((model) => model.id));
}

export function parseImageGenerateBody(raw: unknown): ImageGenerateBody {
  const parsed = imageGenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_content_part", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  return parsed.data;
}

export function parseVideoGenerateBody(raw: unknown): VideoGenerateBody {
  const parsed = videoGenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_content_part", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  if (parsed.data.imageUrl && parsed.data.model && !videoCapabilities(parsed.data.model).imageToVideo) {
    throw new ApiError("video_still_unsupported", "This model does not accept a still image", 400);
  }
  return parsed.data;
}

function toolFailureMessage(output: unknown, fallback: string): string {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const error = (output as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
  }
  return fallback;
}

function toolSuccessUrl(output: unknown, key: "image" | "video"): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  if (record.success !== true) {
    return null;
  }
  const url = record[key];
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

function toolModel(output: unknown, fallback: string): string {
  if (output && typeof output === "object" && !Array.isArray(output)) {
    const model = (output as { model?: unknown }).model;
    if (typeof model === "string" && model.trim()) {
      return model.trim();
    }
  }
  return fallback;
}

async function persistMeta(meta: StudioMediaMeta): Promise<void> {
  try {
    await saveStudioMediaMeta(meta);
  } catch {
    // Gallery still works from the media table without sidecar fields.
  }
}

export function studioRouteReady(capability: "image_gen" | "video_gen"): boolean {
  const routes = listToolRoutes(loadSettings());
  return Boolean(routes[capability]?.ready);
}

export async function generateStudioImage(
  tenant: TenantContext,
  body: ImageGenerateBody,
): Promise<StudioGenerateResult> {
  const settings = loadSettings();
  const scope = buildToolSecretScope(settings);
  const model = body.model || settings.imageGenModel || defaultStudioImageModel();
  const output = await runWithToolSecrets(scope, () =>
    imageGenerateTool.execute(
      {
        prompt: maskPii(body.prompt),
        aspect_ratio: body.aspect,
        image_url: body.imageUrl,
        model,
      },
      tenant,
    ),
  );
  const url = toolSuccessUrl(output, "image");
  if (!url) {
    throw new ApiError("tool_failed", toolFailureMessage(output, "Image generation failed"), 400);
  }
  const { saveGeneratedImage } = await import("./media");
  const stored = await saveGeneratedImage(tenant, url);
  const usedModel = toolModel(output, model);
  const id = mediaIdFromUrl(stored);
  if (id) {
    await persistMeta({
      mediaId: id,
      kind: "image",
      prompt: body.prompt,
      aspect: body.aspect,
      model: usedModel,
      createdAt: new Date().toISOString(),
    });
  }
  return { id, url: stored, prompt: body.prompt, aspect: body.aspect, model: usedModel };
}

export async function generateStudioVideo(
  tenant: TenantContext,
  body: VideoGenerateBody,
): Promise<StudioGenerateResult> {
  if (!studioRouteReady("video_gen")) {
    throw new ApiError(
      "invalid_request",
      "Add a Toko Token gateway key in Settings to generate videos.",
      400,
    );
  }
  const settings = loadSettings();
  const scope = buildToolSecretScope(settings);
  const model = body.model || settings.videoGenModel || defaultStudioVideoModel();
  if (body.imageUrl && !videoCapabilities(model).imageToVideo) {
    throw new ApiError("video_still_unsupported", "This model does not accept a still image", 400);
  }
  const output = await runWithToolSecrets(scope, () =>
    videoGenerateTool.execute(
      {
        prompt: maskPii(body.prompt),
        aspect_ratio: body.aspect,
        image_url: body.imageUrl,
        model,
        seconds: snapVideoSeconds(model, body.seconds),
        resolution: body.resolution,
      },
      tenant,
    ),
  );
  const url = toolSuccessUrl(output, "video");
  if (!url) {
    const message = toolFailureMessage(output, "Video generation failed");
    throw new ApiError("tool_failed", message, studioVideoFailureStatus(message));
  }
  const { saveGeneratedVideo } = await import("./media");
  const stored = await saveGeneratedVideo(tenant, url);
  const usedModel = toolModel(output, model);
  const id = mediaIdFromUrl(stored);
  if (id) {
    await persistMeta({
      mediaId: id,
      kind: "video",
      prompt: body.prompt,
      aspect: body.aspect,
      model: usedModel,
      createdAt: new Date().toISOString(),
    });
  }
  return { id, url: stored, prompt: body.prompt, aspect: body.aspect, model: usedModel };
}

export async function listStudioGallery(
  tenant: TenantContext,
  kind: "image" | "video",
): Promise<StudioGalleryItem[]> {
  const { listMediaByKind } = await import("./media");
  const rows = await listMediaByKind(tenant, kind);
  const items: StudioGalleryItem[] = [];
  for (const row of rows) {
    const meta = await getStudioMediaMeta(row.id);
    items.push({
      id: row.id,
      url: row.url,
      mime: row.mime,
      createdAt: row.createdAt.toISOString(),
      prompt: meta?.prompt,
      aspect: meta?.aspect,
      model: meta?.model,
    });
  }
  return items;
}
