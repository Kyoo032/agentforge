import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
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
    return NextResponse.json({
      items,
      models,
      defaultModel: defaultStudioVideoModel(models),
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
