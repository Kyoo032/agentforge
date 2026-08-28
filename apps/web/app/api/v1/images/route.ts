import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
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
    return NextResponse.json({
      items,
      models,
      defaultModel: defaultStudioImageModel(models),
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
