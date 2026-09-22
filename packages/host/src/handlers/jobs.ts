import { resolveStudioGenerateDefault, resolvedGatewayBaseUrl } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { requireGatewayAllowedFor } from "../gateway-gate";
import { agentService, getTenant } from "../tenant";
import { loadSettings } from "../settings-store";
import {
  defaultStudioImageModel,
  defaultStudioMusicModel,
  defaultStudioVideoModel,
  generateStudioImage,
  generateStudioMusic,
  generateStudioVideo,
  listStudioGallery,
  listStudioImageModels,
  listStudioMusicModels,
  listStudioVideoModels,
  parseImageGenerateBody,
  parseLyricsWriteBody,
  parseMusicGenerateBody,
  parseVideoGenerateBody,
  studioRouteReady,
  studioSpeechUnavailable,
  writeStudioLyrics,
} from "../studio-generate";
import { attachMediaPrices } from "../media-price";
import { withRelayMusicModels } from "../selectable-models";
import { cachedPricingCatalog } from "../account-usage";
import { generateDocumentDraft, regenerateDocumentSection } from "../document-generate";
import { parseDocumentDraftBody } from "../document-outline";
import { buildDocumentDocx } from "../document-docx";
import { generatePresentationOutline, regeneratePresentationSlide } from "../presentation-generate";
import { parsePresentationOutlineBody } from "../presentation-outline";
import { buildPresentationPptx } from "../presentation-pptx";
import { presentationLocale } from "../presentation-locale";
import { generateResearchNotes } from "../research-generate";
import { streamJob } from "../job-stream";
import { analyzeDataset } from "../data-generate";

export async function handleGetImages(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const items = await listStudioGallery(tenant, "image");
    const settings = loadSettings(tenant);
    // Price rows come from the curated list table, with the already-cached gateway catalog as a fallback.
    // Nothing here reaches the network: an uncached desk just shows "no list price on file".
    // Prices are always looked up against the pinned gateway, never an owner-supplied endpoint: a
    // custom base URL must not be able to decide what a model is quoted at.
    const models = attachMediaPrices(
      listStudioImageModels(),
      "image",
      cachedPricingCatalog(resolvedGatewayBaseUrl()),
      resolvedGatewayBaseUrl(),
    );
    const sources = await agentService.listGenerateDefaultSources(tenant);
    const defaultModel = resolveStudioGenerateDefault({
      kind: "image",
      sources,
      settingsModel: settings.imageGenModel,
      catalogPreferred: defaultStudioImageModel(models),
    });
    return jsonOk({ items, models, defaultModel, ready: studioRouteReady("image_gen", tenant) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostImages(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    const result = await generateStudioImage(tenant, parseImageGenerateBody(request.body ?? {}));
    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetVideos(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const items = await listStudioGallery(tenant, "video");
    const settings = loadSettings(tenant);
    // Video list prices are per second, so the gateway's flat per-call rate is never substituted here.
    // Same as images: the pinned gateway, not whatever base URL the desk was pointed at.
    const models = attachMediaPrices(
      listStudioVideoModels(),
      "second",
      cachedPricingCatalog(resolvedGatewayBaseUrl()),
      resolvedGatewayBaseUrl(),
    );
    const sources = await agentService.listGenerateDefaultSources(tenant);
    const defaultModel = resolveStudioGenerateDefault({
      kind: "video",
      sources,
      settingsModel: settings.videoGenModel,
      catalogPreferred: defaultStudioVideoModel(models),
    });
    return jsonOk({ items, models, defaultModel, ready: studioRouteReady("video_gen", tenant) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostVideos(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    const result = await generateStudioVideo(tenant, parseVideoGenerateBody(request.body ?? {}));
    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetMusic(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const items = await listStudioGallery(tenant, "audio");
    const settings = loadSettings(tenant);
    // `listStudioMusicModels` already merges the relay-only ids the gateway never lists (see
    // `withRelayMusicModels`), so the picker is not empty on a desk whose /v1/models has no music.
    const catalog = listStudioMusicModels();
    const sources = await agentService.listGenerateDefaultSources(tenant);
    const defaultModel = resolveStudioGenerateDefault({
      kind: "music",
      sources,
      settingsModel: settings.musicGenModel,
      catalogPreferred: defaultStudioMusicModel(catalog),
    });
    // An agent or Settings pin can name a relay id this build does not know, and `generateStudioMusic`
    // will happily use it. The picker has to be able to show what generate will send, so the resolved
    // default joins the list rather than leaving the select on a value it has no option for.
    //
    // Music is billed a flat rate per job, so the "track" unit takes the gateway catalog's per-call
    // figure. No vendor list price exists for Suno at all — it sells a consumer subscription, not an
    // API — so a desk with no cached catalog honestly shows "no list price on file".
    const models = attachMediaPrices(
      withRelayMusicModels(catalog, [defaultModel]),
      "track",
      cachedPricingCatalog(resolvedGatewayBaseUrl()),
      resolvedGatewayBaseUrl(),
    );
    return jsonOk({
      items,
      models,
      defaultModel,
      ready: studioRouteReady("music_gen", tenant),
      // Why the voice-over control is off, or null when a reachable TTS model exists.
      speechUnavailable: studioSpeechUnavailable(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostMusic(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    const result = await generateStudioMusic(tenant, parseMusicGenerateBody(request.body ?? {}));
    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostMusicLyrics(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    requireGatewayAllowedFor(tenant);
    return jsonOk(await writeStudioLyrics(tenant, parseLyricsWriteBody(request.body ?? {})));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostDocuments(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await generateDocumentDraft(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostDocumentsRegen(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await regenerateDocumentSection(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostDocumentsDocx(request: HostRequest): Promise<HostResult> {
  try {
    const draft = parseDocumentDraftBody(request.body ?? null);
    const { buffer, filename } = await buildDocumentDocx(draft);
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(buffer),
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      filename,
    };
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostPresentations(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await generatePresentationOutline(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostPresentationsRegen(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await regeneratePresentationSlide(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostPresentationsPptx(request: HostRequest): Promise<HostResult> {
  try {
    const outline = parsePresentationOutlineBody(request.body ?? null);
    const locale = presentationLocale();
    const { buffer, filename } = await buildPresentationPptx(outline, { locale });
    return {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array(buffer),
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      filename,
    };
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostResearch(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await generateResearchNotes(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

/** Same job as POST /api/v1/research, streamed as job.* SSE events (phase → step → source → done). */
export async function handlePostResearchStream(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return streamJob((emit, abortSignal) => generateResearchNotes(tenant, request.body ?? null, emit, abortSignal), {
      abortSignal: request.abortSignal,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostData(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return jsonOk(await analyzeDataset(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

/** Same job as POST /api/v1/data, streamed: profiling -> analyzing (one step per SQL query) -> verifying -> saving. */
export async function handlePostDataStream(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    // Every path below reaches the gateway, so a closed gate is a 403 here and not a failed call.
    requireGatewayAllowedFor(tenant);
    return streamJob((emit, abortSignal) => analyzeDataset(tenant, request.body ?? null, emit, abortSignal), {
      abortSignal: request.abortSignal,
    });
  } catch (error) {
    return jsonError(error);
  }
}
