import { NextResponse } from "next/server";

export const maxDuration = 180;
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import { loadSettings } from "@/lib/settings-store";
import { resolveStudioGenerateDefault } from "@agentforge/core";
import {
  defaultStudioVideoModel,
  generateStudioVideo,
  listStudioGallery,
  listStudioVideoModels,
  parseVideoGenerateBody,
  studioRouteReady,
} from "@/lib/studio-generate";

export async function GET() {
  try {
    const tenant = await getTenant();
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
    return NextResponse.json({
      items,
      models,
      defaultModel,
      ready: studioRouteReady("video_gen"),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = parseVideoGenerateBody(await request.json().catch(() => ({})));
    const result = await generateStudioVideo(tenant, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
