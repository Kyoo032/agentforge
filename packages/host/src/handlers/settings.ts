import {
  ApiError,
  type GatewayGatePayload,
  hasLiveProvider,
  HOME_WORKSPACE_NAME,
  isAppLocale,
  listToolCapabilities,
  listToolRoutes,
  maskSecrets,
  redactSecrets,
  resolvedGatewayName,
  resolvedProductName,
  resolveRuntimeMode,
  RESET_CONFIRM_WORD,
  type SecretPatch,
} from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import {
  clearGatewayKeyEverywhere,
  loadSettings,
  localDataDir,
  saveOwnerLocale,
  saveSettings,
} from "../settings-store";
import {
  clearGateState,
  GATEWAY_VERDICT_UNWRITABLE_MESSAGE,
  maybeRefreshGateway,
  reportGatewayGate,
  runGatewayCheck,
} from "../gateway-gate";
import { killTrackedChildren } from "../child-processes";
import { applySavedLocaleAsBoot, localePayload } from "../locale-boot";
import { refreshModelCache, modeCatalogPayload } from "../selectable-models";
import { clearThisKeyCache, loadAccountUsage } from "../account-usage";
import { probeSummary } from "../model-cache";
import { db, hasPendingDataReset, listLocalWorkspaces, pendingResetPath, requestDataReset } from "@agentforge/db";
import { rmSync } from "node:fs";
import { resetEmbedCircuit } from "../knowledge-embed";
import { resetJobModelCircuit } from "../job-model-fallback";
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
    // The host decides; the renderer only displays `allowed`. See gateway-gate.ts.
    gateway: reportGatewayGate(settings),
    // True while a queued wipe is waiting for the next boot, so Settings can offer to call it off.
    resetPending: hasPendingDataReset(localDataDir()),
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
    const settings = loadSettings(tenant.workspaceId);
    // A desk that upgraded into the gate has a key but no verdict, and a verdict goes stale after a
    // day. Both are opened on trust, so this is where the gateway actually gets asked. Fire-and-
    // forget and throttled: the response never waits for it.
    maybeRefreshGateway(settings);
    return jsonOk(await settingsPayload(settings, tenant));
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
    // A fixed key / URL must take effect now, not after the 5-minute embeddings breaker expires —
    // and the job-side breaker skips a model for the same five minutes, so it is cleared with it.
    resetEmbedCircuit();
    resetJobModelCircuit();
    // The retrieval sidecar holds a *copy* of the gateway key, inside the model row it embeds with.
    // A key that has been changed here but left in that database has not been rotated, so the row
    // is revoked; the next knowledge call mints a fresh one against the new credentials.
    await revokeKnowledgeGatewayModel(tenant);
    try {
      await refreshModelCache(saved);
    } catch {
      // Airplane mode: key stays on disk; probe happens on generate.
    }
    let gateRefreshFailed = false;
    let freshGate: GatewayGatePayload | null = null;
    try {
      freshGate = await refreshGatewayGateAfterSave(body, saved);
    } catch (error) {
      // The key is already on disk by the time we get here. A verdict that could not be refreshed
      // or written — an unwritable data dir, a full disk, a directory squatting on
      // `gateway-gate.json` — is a stale verdict, not a lost key, so it must not come back as
      // "saving your key failed" and send the owner off to paste it again. `allowed` is left
      // exactly as derived: an unwritable state file is no reason to lock the desk out.
      gateRefreshFailed = true;
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`gateway verdict refresh failed after save: ${redactSecrets(detail)}`);
    }
    const catalog = modeCatalogPayload();
    const payload = await settingsPayload(saved, tenant);
    return jsonOk({
      ...payload,
      gateway: gateVerdictFor(payload.gateway, freshGate, gateRefreshFailed),
      modes: catalog.modes,
      defaults: catalog.defaults,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleApplyLocale(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    applySavedLocaleAsBoot();
    return jsonOk(await settingsPayload(loadSettings(tenant.workspaceId), tenant));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * A key is only worth anything once the gateway has seen it, so saving one validates it now and the
 * response carries the fresh verdict. Clearing one throws the verdict away with it.
 *
 * `runGatewayCheck` turns a rejected or unreachable gateway into a persisted verdict rather than a
 * throw, so the usual failures never reach the caller. Disk failures still can, which is why the
 * one call site treats a throw here as a stale verdict and not as a failed save.
 */
/**
 * Which verdict the save response carries. The one `runGatewayCheck` just returned wins, because it
 * is the only one that knows a verdict was reached but not stored. `failed` is the last-resort case
 * where the refresh threw outright: the key is saved, so the gate is reported as `error` without
 * touching `allowed` — an unwritable data dir must not close a desk.
 */
function gateVerdictFor(
  derived: GatewayGatePayload,
  fresh: GatewayGatePayload | null,
  failed: boolean,
): GatewayGatePayload {
  if (failed) {
    return { ...derived, status: "error", message: GATEWAY_VERDICT_UNWRITABLE_MESSAGE };
  }
  return fresh ?? derived;
}

async function refreshGatewayGateAfterSave(
  body: Record<string, unknown>,
  saved: ReturnType<typeof saveSettings>,
): Promise<GatewayGatePayload | null> {
  if (typeof body.openaiApiKey !== "string") {
    return null;
  }
  if (body.openaiApiKey.trim().length === 0) {
    clearGateState();
    return null;
  }
  // The verdict this returns is the one the response carries. Re-deriving it from disk instead
  // would throw away the one case where the two differ: a verdict that was reached but could not
  // be written, which disk reads back as "never checked".
  return await runGatewayCheck(saved);
}

export async function handleGatewayCheck(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const gateway = await runGatewayCheck(loadSettings(tenant.workspaceId));
    return jsonOk({ gateway });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Everything under the data dir that the host itself wrote. Deliberately a named list, never the
 * directory: in the packaged app this same folder is Electron's userData / Chromium profile, so
 * `host-status.json`, `Local Storage/`, caches and cookies are not ours to delete. The SQLite trio
 * is added by `applyPendingDataReset`, because `@agentforge/db` owns it.
 */
export const HOST_RESET_ENTRIES = [
  "settings.enc",
  "settings.json",
  ".master-key",
  "gateway-gate.json",
  "media",
  "workspace-id.txt",
  "desk-usage.json",
  "datasets",
  "edit",
  "legal",
  "models-cache.json",
  "models-dev-cache.json",
  // Downloaded native components (packages/host/src/components). Written by the host, inside the
  // data dir, and re-downloadable — so a full "Start over" drops it like everything else the host
  // wrote. The cost of being wrong here is one re-download, never data.
  "components",
  // The component installer's own diagnostics. Same reasoning; nothing in it is the owner's work.
  "logs",
] as const;

function resetGatewayKey(workspaceId: string): HostResult {
  // Machine-wide: a key left on a second desk would keep the gate open after "forget my key".
  clearGatewayKeyEverywhere();
  clearGateState();
  clearThisKeyCache();
  resetEmbedCircuit();
  resetJobModelCircuit();
  return jsonOk({
    ok: true,
    scope: "key",
    relaunch: false,
    resetPending: hasPendingDataReset(localDataDir()),
    gateway: reportGatewayGate(loadSettings(workspaceId)),
  });
}

function resetEverything(workspaceId: string, confirm: string | undefined): HostResult {
  if (confirm !== RESET_CONFIRM_WORD) {
    throw new ApiError("invalid_request", `confirm must be "${RESET_CONFIRM_WORD}" to erase everything`, 400);
  }
  // The database is open and ffmpeg may still be writing, so the wipe is queued for the next boot.
  requestDataReset(localDataDir(), [...HOST_RESET_ENTRIES]);
  killTrackedChildren();
  return jsonOk({
    ok: true,
    scope: "all",
    relaunch: true,
    resetPending: hasPendingDataReset(localDataDir()),
    gateway: reportGatewayGate(loadSettings(workspaceId)),
  });
}

export async function handleResetApp(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const scope = readOptionalString(body.scope);
    if (scope === "key") {
      return resetGatewayKey(tenant.workspaceId);
    }
    if (scope === "all") {
      return resetEverything(tenant.workspaceId, readOptionalString(body.confirm));
    }
    throw new ApiError("invalid_request", 'scope must be "key" or "all"', 400);
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Call off a queued wipe. The marker is the whole of the pending state, so unlinking it is the
 * cancel. Idempotent on purpose: the owner asked for nothing to be pending, and after this nothing
 * is, whether or not anything was.
 */
export async function handleCancelReset(request: HostRequest): Promise<HostResult> {
  try {
    await getTenant(request.workspaceId);
    // `recursive` so that a directory left at the marker path — a botched restore, a sync client —
    // is cleared like anything else instead of throwing EISDIR and turning "cancel my wipe" into a
    // 500 the owner cannot get past.
    rmSync(pendingResetPath(localDataDir()), { force: true, recursive: true });
    return jsonOk({ ok: true, resetPending: false });
  } catch (error) {
    return jsonError(error);
  }
}
