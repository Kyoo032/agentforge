import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { defaultSelectableModel, listSelectableModels, refreshModelCache } from "@/lib/selectable-models";
import { probeSummary } from "@/lib/model-cache";
import { loadSettings } from "@/lib/settings-store";

export async function GET() {
  try {
    await getTenant();
    const models = listSelectableModels();
    return NextResponse.json({ models, defaultModel: defaultSelectableModel(models) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    await getTenant();
    const probe = await refreshModelCache(loadSettings());
    const models = listSelectableModels();
    return NextResponse.json({
      models,
      defaultModel: defaultSelectableModel(models),
      probe: probeSummary(probe),
    });
  } catch (error) {
    return jsonError(error);
  }
}
