import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { agentService, getTenant } from "@/lib/tenant";
import { loadSettings } from "@/lib/settings-store";
import { resolveStudioGenerateDefault } from "@agentforge/core";
import {
  defaultStudioImageModel,
  generateStudioImage,
  listStudioGallery,
  listStudioImageModels,
  parseImageGenerateBody,
  studioRouteReady,
} from "@/lib/studio-generate";

export async function GET() {
  try {
    const tenant = await getTenant();
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
    return NextResponse.json({
      items,
      models,
      defaultModel,
      ready: studioRouteReady("image_gen"),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = parseImageGenerateBody(await request.json().catch(() => ({})));
    const result = await generateStudioImage(tenant, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
