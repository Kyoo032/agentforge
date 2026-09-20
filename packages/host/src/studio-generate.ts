import { z } from "zod";
import {
  ApiError,
  buildToolSecretScope,
  gatewayRequiredMessage,
  imageGenerateTool,
  isMusicModelId,
  isSpeechModelId,
  listToolRoutes,
  lyricsWriteTool,
  maskPii,
  mediaKind,
  modeMessage,
  musicCapabilities,
  musicGenerateTool,
  pickPreferredImageModel,
  pickPreferredMusicModel,
  pickPreferredVideoModel,
  resolveMusicMode,
  runWithToolSecrets,
  speechUnavailableReason,
  studioVideoFailureStatus,
  videoCapabilities,
  snapVideoSeconds,
  videoGenerateTool,
  withOutputLanguage,
  MUSIC_LYRICS_MAX,
  MUSIC_PROMPT_MAX,
  MUSIC_STYLE_MAX,
  MUSIC_TITLE_MAX,
  type ChatModel,
  type GatewayTrack,
  type MusicMode,
  type SpeechUnavailableReason,
  type TenantContext,
} from "@agentforge/core";
import { loadSettings } from "./settings-store";
import { listImageModels, listMusicModels, listSpeechModels, listVideoModels } from "./selectable-models";
import { mediaIdFromUrl } from "./media-id";
import { getStudioMediaMeta, saveStudioMediaMeta, type StudioMediaMeta } from "./studio-media-meta";
import { upsertWorkSource } from "./knowledge-ingest";
import { mediaWorkCard, musicWorkCard } from "./work-cards";
import type { WorkSourceType } from "./knowledge";
import { imageGenerateFailedMessage, withImageOutputLanguage } from "./image-output-locale";
import { localeForRun } from "./run-context";
import { recordImageUsage, recordMusicUsage, recordVideoUsage } from "./usage-record";

export type StudioGenerateOptions = {
  /** Knowledge source type for the work card. Defaults to Images / Videos; Edit passes "Edit". */
  workType?: Extract<WorkSourceType, "Images" | "Videos" | "Edit">;
};

/** The media kinds a studio gallery can list. Music shares the media store with Images and Videos. */
export type StudioKind = "image" | "video" | "audio";

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

/**
 * A music job is either a description the model turns into a song, or lyrics the desk wrote with a
 * style and a title. `mode` decides which fields are read; the parser refuses the combination that
 * would submit an empty brief rather than letting the gateway bill for it.
 */
export const musicGenerateBodySchema = z.object({
  mode: z.enum(["describe", "custom"]).optional().default("describe"),
  prompt: z.string().trim().max(MUSIC_PROMPT_MAX).optional(),
  lyrics: z.string().trim().max(MUSIC_LYRICS_MAX).optional(),
  style: z.string().trim().max(MUSIC_STYLE_MAX).optional(),
  title: z.string().trim().max(MUSIC_TITLE_MAX).optional(),
  instrumental: z.boolean().optional().default(false),
  model: z.string().trim().min(1).optional(),
});

export const lyricsWriteBodySchema = z.object({
  prompt: z.string().trim().min(1, "prompt is required").max(MUSIC_PROMPT_MAX),
  model: z.string().trim().min(1).optional(),
});

export type ImageGenerateBody = z.infer<typeof imageGenerateBodySchema>;
export type VideoGenerateBody = z.infer<typeof videoGenerateBodySchema>;
export type MusicGenerateBody = z.infer<typeof musicGenerateBodySchema>;
export type LyricsWriteBody = z.infer<typeof lyricsWriteBodySchema>;

export type StudioGalleryItem = {
  id: string;
  url: string;
  mime: string;
  createdAt: string;
  prompt?: string;
  aspect?: string;
  model?: string;
  /** Music rows only. */
  title?: string;
  style?: string;
  instrumental?: boolean;
  durationSeconds?: number;
};

export type StudioGenerateResult = {
  id: string | null;
  url: string;
  prompt: string;
  aspect: string;
  model: string;
};

/** One saved take. Suno returns two per job, and the desk is billed once for both. */
export type StudioTrackResult = {
  id: string | null;
  url: string;
  title?: string;
  durationSeconds?: number;
};

export type StudioMusicResult = {
  tracks: StudioTrackResult[];
  prompt: string;
  mode: MusicMode;
  model: string;
  style?: string;
  instrumental: boolean;
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

export function listStudioMusicModels(models: ChatModel[] = listMusicModels()): ChatModel[] {
  return models.filter((model) => isMusicModelId(model.id));
}

export function defaultStudioMusicModel(models: ChatModel[] = listStudioMusicModels()): string {
  return pickPreferredMusicModel(models.map((model) => model.id));
}

/**
 * Why the studio's voice-over control is off, or `null` when a text-to-speech model is reachable.
 *
 * The catalog's only TTS id is realtime, and a realtime id speaks WebSocket behind an `openai`
 * endpoint label, so a job route cannot drive it. Reporting the reason is the whole point: the
 * studio says "this gateway serves no reachable speech model" instead of failing at submit.
 */
export function studioSpeechUnavailable(models: ChatModel[] = listSpeechModels()): SpeechUnavailableReason | null {
  return speechUnavailableReason(models.map((model) => model.id));
}

export function listStudioSpeechModels(models: ChatModel[] = listSpeechModels()): ChatModel[] {
  return models.filter((model) => isSpeechModelId(model.id));
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
    throw new ApiError("video_still_unsupported", modeMessage("videoStillUnsupported", localeForRun()), 400);
  }
  return parsed.data;
}

export function parseMusicGenerateBody(raw: unknown): MusicGenerateBody {
  const parsed = musicGenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_content_part", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const body = parsed.data;
  if (body.mode === "custom") {
    if (!body.lyrics?.trim()) {
      throw new ApiError("invalid_content_part", modeMessage("musicLyricsRequired", localeForRun()), 400);
    }
  } else if (!body.prompt?.trim()) {
    throw new ApiError("invalid_content_part", modeMessage("musicPromptRequired", localeForRun()), 400);
  }
  return body;
}

export function parseLyricsWriteBody(raw: unknown): LyricsWriteBody {
  const parsed = lyricsWriteBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("invalid_content_part", parsed.error.issues[0]?.message ?? "Invalid body", 400);
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

export function studioRouteReady(
  capability: "image_gen" | "video_gen" | "music_gen" | "speech_gen",
  tenant: TenantContext,
): boolean {
  const routes = listToolRoutes(loadSettings(tenant));
  return Boolean(routes[capability]?.ready);
}

export async function generateStudioImage(
  tenant: TenantContext,
  body: ImageGenerateBody,
  options: StudioGenerateOptions = {},
): Promise<StudioGenerateResult> {
  const settings = loadSettings(tenant);
  const locale = localeForRun();
  const scope = buildToolSecretScope(settings);
  const model = body.model || settings.imageGenModel || defaultStudioImageModel();
  const output = await runWithToolSecrets(scope, () =>
    imageGenerateTool.execute(
      {
        prompt: withImageOutputLanguage(maskPii(body.prompt), locale),
        aspect_ratio: body.aspect,
        image_url: body.imageUrl,
        model,
      },
      tenant,
    ),
  );
  const url = toolSuccessUrl(output, "image");
  if (!url) {
    throw new ApiError("tool_failed", toolFailureMessage(output, imageGenerateFailedMessage(locale)), 400);
  }
  // Metered here, not after the file is stored: the gateway has already charged for this image, so
  // a failure to save it must not be a call that vanishes from the ledger (Phase 5 lane A). The
  // model recorded is the one that answered, which is not always the one that was asked for.
  const usedModel = toolModel(output, model);
  recordImageUsage(tenant, { model: usedModel, count: 1, aspect: body.aspect });
  const { saveGeneratedImage } = await import("./media");
  const stored = await saveGeneratedImage(tenant, url);
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
    await upsertWorkSource(
      tenant,
      mediaWorkCard({
        kind: "image",
        mediaId: id,
        prompt: body.prompt,
        aspect: body.aspect,
        model: usedModel,
        url: stored,
        type: options.workType,
      }),
    );
  }
  return { id, url: stored, prompt: body.prompt, aspect: body.aspect, model: usedModel };
}

export async function generateStudioVideo(
  tenant: TenantContext,
  body: VideoGenerateBody,
  options: StudioGenerateOptions = {},
): Promise<StudioGenerateResult> {
  if (!studioRouteReady("video_gen", tenant)) {
    throw new ApiError("invalid_request", gatewayRequiredMessage("videos", localeForRun()), 400);
  }
  const settings = loadSettings(tenant);
  const scope = buildToolSecretScope(settings);
  const model = body.model || settings.videoGenModel || defaultStudioVideoModel();
  if (body.imageUrl && !videoCapabilities(model).imageToVideo) {
    throw new ApiError("video_still_unsupported", modeMessage("videoStillUnsupported", localeForRun()), 400);
  }
  // The billable length is the snapped one the gateway is actually asked for, never `body.seconds`:
  // a model that only does 5 s clips bills 5 s for a 4 s request.
  const seconds = snapVideoSeconds(model, body.seconds);
  const output = await runWithToolSecrets(scope, () =>
    videoGenerateTool.execute(
      {
        prompt: withOutputLanguage(maskPii(body.prompt), "videos", localeForRun()),
        aspect_ratio: body.aspect,
        image_url: body.imageUrl,
        model,
        seconds,
        resolution: body.resolution,
      },
      tenant,
    ),
  );
  const url = toolSuccessUrl(output, "video");
  if (!url) {
    const message = toolFailureMessage(output, modeMessage("videoGenerateFailed", localeForRun()));
    throw new ApiError("tool_failed", message, studioVideoFailureStatus(message));
  }
  // Same rule as images: the gateway has been paid, so the row is written before the file is
  // stored. Videos are metered in seconds because every list price in `media-pricing.ts` is
  // per second, and the clip length is the only thing that moves the number.
  const usedModel = toolModel(output, model);
  recordVideoUsage(tenant, {
    model: usedModel,
    seconds,
    ...(body.resolution ? { resolution: body.resolution } : {}),
  });
  const { saveGeneratedVideo } = await import("./media");
  const stored = await saveGeneratedVideo(tenant, url);
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
    await upsertWorkSource(
      tenant,
      mediaWorkCard({
        kind: "video",
        mediaId: id,
        prompt: body.prompt,
        aspect: body.aspect,
        model: usedModel,
        url: stored,
        seconds: body.seconds,
        resolution: body.resolution,
        type: options.workType,
      }),
    );
  }
  return { id, url: stored, prompt: body.prompt, aspect: body.aspect, model: usedModel };
}

/** The text a music job is remembered by: the lyrics in custom mode, the brief in describe mode. */
function musicPromptOf(body: MusicGenerateBody): string {
  return (body.mode === "custom" ? body.lyrics : body.prompt)?.trim() ?? "";
}

function toolTracks(output: unknown): GatewayTrack[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [];
  }
  const record = output as Record<string, unknown>;
  if (record.success !== true || !Array.isArray(record.tracks)) {
    return [];
  }
  return record.tracks.filter(
    (track): track is GatewayTrack =>
      Boolean(track) && typeof track === "object" && typeof (track as GatewayTrack).url === "string",
  );
}

/**
 * Run one music job and mirror every take it returns.
 *
 * The desk is billed once for the job and Suno hands back two takes, so both are saved: dropping one
 * would throw away something already paid for. Each take becomes its own media row and its own
 * Knowledge card, because each is a separate file the desk may keep or delete on its own.
 */
export async function generateStudioMusic(
  tenant: TenantContext,
  body: MusicGenerateBody,
): Promise<StudioMusicResult> {
  if (!studioRouteReady("music_gen", tenant)) {
    throw new ApiError("invalid_request", gatewayRequiredMessage("music", localeForRun()), 400);
  }
  const settings = loadSettings(tenant);
  const locale = localeForRun();
  const scope = buildToolSecretScope(settings);
  const model = body.model || settings.musicGenModel || defaultStudioMusicModel();
  const caps = musicCapabilities(model);
  const mode = resolveMusicMode(model, body.mode);
  const prompt = musicPromptOf(body);
  if (!prompt) {
    const key = mode === "custom" ? "musicLyricsRequired" : "musicPromptRequired";
    throw new ApiError("invalid_content_part", modeMessage(key, locale), 400);
  }
  const style = caps.style ? body.style?.trim() || undefined : undefined;
  const title = caps.title ? body.title?.trim() || undefined : undefined;
  const instrumental = caps.instrumental && body.instrumental === true;
  const output = await runWithToolSecrets(scope, () =>
    musicGenerateTool.execute(
      {
        // The language rule rides the words the model actually writes from, never the style tags.
        ...(mode === "custom"
          ? { lyrics: withOutputLanguage(maskPii(prompt), "music", locale) }
          : { prompt: withOutputLanguage(maskPii(prompt), "music", locale) }),
        style,
        title,
        instrumental,
        model,
      },
      tenant,
    ),
  );
  const tracks = toolTracks(output);
  if (tracks.length === 0) {
    throw new ApiError(
      "tool_failed",
      toolFailureMessage(output, modeMessage("musicGenerateFailed", locale)),
      studioVideoFailureStatus(toolFailureMessage(output, "")),
    );
  }
  const usedModel = toolModel(output, model);
  // One charge, however many takes come back — so the unit is `jobs` and the quantity is 1. Metered
  // before the takes are stored, like the other studios: the gateway has already billed for them.
  recordMusicUsage(tenant, { model: usedModel });
  const { saveGeneratedAudio } = await import("./media");
  const saved: StudioTrackResult[] = [];
  for (const track of tracks) {
    const stored = await saveGeneratedAudio(tenant, track.url);
    const id = mediaIdFromUrl(stored);
    if (id) {
      await persistMeta({
        mediaId: id,
        kind: "audio",
        prompt,
        aspect: "",
        model: usedModel,
        createdAt: new Date().toISOString(),
        title: track.title ?? title,
        style,
        instrumental,
        durationSeconds: track.durationSeconds,
      });
      await upsertWorkSource(
        tenant,
        musicWorkCard({
          mediaId: id,
          prompt,
          model: usedModel,
          url: stored,
          mode,
          title: track.title ?? title,
          style,
          instrumental,
          durationSeconds: track.durationSeconds,
        }),
      );
    }
    saved.push({ id, url: stored, title: track.title ?? title, durationSeconds: track.durationSeconds });
  }
  return { tracks: saved, prompt, mode, model: usedModel, style, instrumental };
}

/** Draft lyrics only. Nothing is stored: the text goes straight back for the desk to edit. */
export async function writeStudioLyrics(
  tenant: TenantContext,
  body: LyricsWriteBody,
): Promise<{ text: string; title?: string; model: string }> {
  if (!studioRouteReady("music_gen", tenant)) {
    throw new ApiError("invalid_request", gatewayRequiredMessage("music", localeForRun()), 400);
  }
  const settings = loadSettings(tenant);
  const locale = localeForRun();
  const output = await runWithToolSecrets(buildToolSecretScope(settings), () =>
    lyricsWriteTool.execute(
      { prompt: withOutputLanguage(maskPii(body.prompt), "music", locale), model: body.model },
      tenant,
    ),
  );
  const record = output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (record.success !== true || !text) {
    throw new ApiError("tool_failed", toolFailureMessage(output, modeMessage("lyricsGenerateFailed", locale)), 400);
  }
  const usedModel = toolModel(output, body.model ?? "");
  // A lyrics draft is its own flat-rate gateway call, billed whether or not the desk goes on to
  // generate a song from it.
  recordMusicUsage(tenant, { model: usedModel });
  return {
    text,
    title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : undefined,
    model: usedModel,
  };
}

export async function listStudioGallery(
  tenant: TenantContext,
  kind: StudioKind,
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
      title: meta?.title,
      style: meta?.style,
      instrumental: meta?.instrumental,
      durationSeconds: meta?.durationSeconds,
    });
  }
  return items;
}
