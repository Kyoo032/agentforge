import { resolveStudioGenerateDefault } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { agentService, getTenant } from "../tenant";
import { loadSettings } from "../settings-store";
import {
  defaultStudioImageModel,
  defaultStudioVideoModel,
  generateStudioImage,
  generateStudioVideo,
  listStudioGallery,
  listStudioImageModels,
  listStudioVideoModels,
  parseImageGenerateBody,
  parseVideoGenerateBody,
  studioRouteReady,
} from "../studio-generate";
import { generateDocumentDraft, regenerateDocumentSection } from "../document-generate";
import { parseDocumentDraftBody } from "../document-outline";
import { buildDocumentDocx } from "../document-docx";
import { generatePresentationOutline, regeneratePresentationSlide } from "../presentation-generate";
import { parsePresentationOutlineBody } from "../presentation-outline";
import { buildPresentationPptx } from "../presentation-pptx";
import { generateResearchNotes } from "../research-generate";

export async function handleGetImages(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const models = listStudioImageModels();
    const items = await listStudioGallery(tenant, "image");
    const settings = loadSettings();
    const sources = await agentService.listGenerateDefaultSources(tenant);
    const defaultModel = resolveStudioGenerateDefault({
      kind: "image",
      sources,
      settingsModel: settings.imageGenModel,
      catalogPreferred: defaultStudioImageModel(models),
    });
    return jsonOk({ items, models, defaultModel, ready: studioRouteReady("image_gen") });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostImages(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const result = await generateStudioImage(tenant, parseImageGenerateBody(request.body ?? {}));
    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetVideos(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const models = listStudioVideoModels();
    const items = await listStudioGallery(tenant, "video");
    const settings = loadSettings();
    const sources = await agentService.listGenerateDefaultSources(tenant);
    const defaultModel = resolveStudioGenerateDefault({
      kind: "video",
      sources,
      settingsModel: settings.videoGenModel,
      catalogPreferred: defaultStudioVideoModel(models),
    });
    return jsonOk({ items, models, defaultModel, ready: studioRouteReady("video_gen") });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostVideos(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const result = await generateStudioVideo(tenant, parseVideoGenerateBody(request.body ?? {}));
    return jsonOk(result, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostDocuments(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await generateDocumentDraft(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostDocumentsRegen(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
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
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await generatePresentationOutline(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostPresentationsRegen(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await regeneratePresentationSlide(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostPresentationsPptx(request: HostRequest): Promise<HostResult> {
  try {
    const outline = parsePresentationOutlineBody(request.body ?? null);
    const { buffer, filename } = await buildPresentationPptx(outline);
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
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await generateResearchNotes(tenant, request.body ?? null));
  } catch (error) {
    return jsonError(error);
  }
}
