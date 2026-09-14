import {
  ApiError,
  hasLiveProvider,
  HOME_WORKSPACE_NAME,
  isAppLocale,
  listToolCapabilities,
  listToolRoutes,
  maskSecrets,
  resolvedGatewayName,
  resolvedProductName,
  resolveRuntimeMode,
  type SecretPatch,
} from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { loadSettings, saveOwnerLocale, saveSettings } from "../settings-store";
import { localePayload } from "../locale-boot";
import { refreshModelCache, modeCatalogPayload } from "../selectable-models";
import { clearThisKeyCache, loadAccountUsage } from "../account-usage";
import { probeSummary } from "../model-cache";
import { db, listLocalWorkspaces } from "@agentforge/db";
import { resetEmbedCircuit } from "../knowledge-embed";
import { revokeKnowledgeGatewayModel } from "../knowledge/backend-api";

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") {
      next[key] = item;
    }
  }
  return next;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

async function settingsPayload(
  settings: ReturnType<typeof loadSettings>,
  tenant: Awaited<ReturnType<typeof getTenant>>,
) {
  const rows = await listLocalWorkspaces(db, tenant.organizationId);
  const current = rows.find((row) => row.id === tenant.workspaceId);
  return {
    ...maskSecrets(settings),
    ...localePayload(),
    workspaceId: tenant.workspaceId,
    workspaceName: current?.name ?? HOME_WORKSPACE_NAME,
    productName: resolvedProductName(),
    gatewayName: resolvedGatewayName(),
    runtime: resolveRuntimeMode({
      settingsHasKey: hasLiveProvider(settings),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    }),
    probe: probeSummary(),
    ...modeCatalogPayload(),
    toolCatalog: listToolCapabilities().map((capability) => ({
      id: capability.id,
      label: capability.label,
      description: capability.description,
      backends: capability.backends.map((backend) => ({
        id: backend.id,
        label: backend.label,
        envVars: backend.envVars,
        urlVars: backend.urlVars ?? [],
      })),
    })),
    toolRoutes: listToolRoutes(settings),
    usage: await loadAccountUsage(settings, tenant),
  };
}

export async function handleGetSettings(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(await settingsPayload(loadSettings(tenant.workspaceId), tenant));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handlePostSettings(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.locale !== undefined) {
      if (!isAppLocale(body.locale)) {
        throw new ApiError("invalid_request", "locale must be en or id", 400);
      }
      saveOwnerLocale(body.locale);
    }
    const patch: SecretPatch = {
      openaiApiKey: typeof body.openaiApiKey === "string" ? body.openaiApiKey : undefined,
      googleApiKey: typeof body.googleApiKey === "string" ? body.googleApiKey : undefined,
      anthropicApiKey: typeof body.anthropicApiKey === "string" ? body.anthropicApiKey : undefined,
      volcengineApiKey: typeof body.volcengineApiKey === "string" ? body.volcengineApiKey : undefined,
      openaiBaseUrl: readOptionalString(body.openaiBaseUrl),
      toolKeys: readStringMap(body.toolKeys),
      toolBackends: readStringMap(body.toolBackends),
      imageGenModel: readOptionalString(body.imageGenModel),
      videoGenModel: readOptionalString(body.videoGenModel),
      documentGenModel: readOptionalString(body.documentGenModel),
      researchGenModel: readOptionalString(body.researchGenModel),
      presentationGenModel: readOptionalString(body.presentationGenModel),
      disabledTools: readStringArray(body.disabledTools),
      injectionGuardBypass: readOptionalBoolean(body.injectionGuardBypass),
      editTurnCapUsd: readOptionalNumber(body.editTurnCapUsd),
    };
    const saved = saveSettings(patch, tenant.workspaceId);
    clearThisKeyCache();
    // A fixed key / URL must take effect now, not after the 5-minute embeddings breaker expires.
    resetEmbedCircuit();
    // The retrieval sidecar holds a *copy* of the gateway key, inside the model row it embeds with.
    // A key that has been changed here but left in that database has not been rotated, so the row
    // is revoked; the next knowledge call mints a fresh one against the new credentials.
    await revokeKnowledgeGatewayModel(tenant);
    try {
      await refreshModelCache(saved);
    } catch {
      // Airplane mode: key stays on disk; probe happens on generate.
    }
    const catalog = modeCatalogPayload();
    return jsonOk({
      ...(await settingsPayload(saved, tenant)),
      modes: catalog.modes,
      defaults: catalog.defaults,
    });
  } catch (error) {
    return jsonError(error);
  }
}
