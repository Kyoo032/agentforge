import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { defaultSelectableModel, listSelectableModels, modeCatalogPayload, refreshModelCache } from "../selectable-models";
import { probeSummary } from "../model-cache";
import { loadSettings } from "../settings-store";

export async function handleGetModels(request: HostRequest): Promise<HostResult> {
  try {
    await getTenant(request.workspaceId);
    const models = listSelectableModels();
    const catalog = modeCatalogPayload();
    return jsonOk({
      models,
      defaultModel: defaultSelectableModel(models),
      modes: catalog.modes,
      defaults: catalog.defaults,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostModels(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const probe = await refreshModelCache(loadSettings(tenant.workspaceId));
    const models = listSelectableModels();
    const catalog = modeCatalogPayload();
    return jsonOk({
      models,
      defaultModel: defaultSelectableModel(models),
      modes: catalog.modes,
      defaults: catalog.defaults,
      probe: probeSummary(probe),
    });
  } catch (error) {
    return jsonError(error);
  }
}
