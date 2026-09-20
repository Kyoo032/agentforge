import {
  ApiError,
  type GatewayGatePayload,
  hasLiveProvider,
  HOME_WORKSPACE_NAME,
  isAppLocale,
  isServerMode,
  listToolCapabilities,
  listToolRoutes,
  maskSecrets,
  redactSecrets,
  resolvedGatewayName,
  type TenantContext,
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
    gateway: reportGatewayGate(settings, { tenant }),
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
    const tenant = await getTenant(request);
    const settings = loadSettings(tenant);
    // A desk that upgraded into the gate has a key but no verdict, and a verdict goes stale after a
    // day. Both are opened on trust, so this is where the gateway actually gets asked. Fire-and-
    // forget and throttled: the response never waits for it.
    maybeRefreshGateway(settings, { tenant });
    return jsonOk(await settingsPayload(settings, tenant));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * Fields of `POST /api/v1/settings` that belong to the OPERATOR, not to the caller
 * (docs/internal/security-owasp-2026-09.md, finding A01-3).
 *
 * The settings store is machine-wide, so each of these is shared by every tenant on the box:
 * `toolKeys` / `toolBackends` are the credentials and endpoints every tenant's tools run through,
 * and `injectionGuardBypass` switches off the prompt-injection guard for the whole process. The
 * handler had no notion of privilege, so one signed-in tenant could rewrite any of them for
 * everybody. In server mode a request that carries one is refused.
 *
 * THE PROVIDER KEYS ARE DELIBERATELY NOT IN THIS LIST, and the first version of this fix had them
 * here — which bricked the hosted deploy. Onboarding and Settings are the only ways to supply the
 * gateway key, both post it here, and the environment fallback in `gateway-gate.ts` only applies
 * when `AGENTFORGE_RUNTIME=ai`, which `webapp-deploy/compose.yml` does not set and the runbook says
 * to leave alone. Refusing key writes therefore left a Phase 0 deploy on an onboarding screen whose
 * only button answered 403, with no other route to a working server. It also pre-empted Phase 4,
 * where each tenant supplies their own key and this becomes a scoping question rather than a
 * privilege one. So key writes behave exactly as they did before this branch.
 *
 * What DID need fixing about the keys is narrower and is handled by `keyFieldValue` below: a key
 * sent as the EMPTY string is not a change anyone asked for — it is the renderer echoing an input
 * nobody typed in (`apps/web/components/settings-page.tsx` posts `openaiApiKey` from state on every
 * save) — and `mergeSecrets` DELETES the stored key on an empty string. So on the hosted service
 * the Settings page was wiping the operator's gateway key, for every tenant, each time anyone saved
 * a spend cap.
 */
const OPERATOR_ONLY_CODE = "settings_operator_only";
const OPERATOR_ONLY_MESSAGE =
  "Those settings are managed by the operator on the hosted service: the tool credentials and " +
  "backends, and the prompt-injection guard. They are shared by every tenant on this server, so " +
  "they cannot be changed from here.";

/** True when the body asks to change a field the operator owns. Keys are not among them — see above. */
export function requestsOperatorOnlySettings(body: Record<string, unknown>): boolean {
  for (const field of ["toolKeys", "toolBackends"] as const) {
    const value = body[field];
    if (value !== null && typeof value === "object" && Object.keys(value as object).length > 0) {
      return true;
    }
  }
  return body.injectionGuardBypass === true;
}

/**
 * A provider key on its way into the patch.
 *
 * Off server mode this is the identity on any string, so a desk owner clearing the field still
 * means "forget my key" and `mergeSecrets` still deletes it. In server mode a blank is dropped
 * instead of forwarded, which is what stops the shared key being wiped by a Settings save that
 * never meant to touch it. A real value passes through in both.
 */
export function keyFieldValue(raw: unknown, serverMode: boolean): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  if (serverMode && raw.trim().length === 0) {
    return undefined;
  }
  return raw;
}

/** Injected like `ResetDeps` below, so a test can exercise hosted behaviour without the env flag. */
export type ServerModeDeps = { isServerMode?: () => boolean };

export async function handlePostSettings(request: HostRequest, deps: ServerModeDeps = {}): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const serverMode = deps.isServerMode ? deps.isServerMode() : isServerMode();
    if (serverMode && requestsOperatorOnlySettings(body)) {
      throw new ApiError(OPERATOR_ONLY_CODE, OPERATOR_ONLY_MESSAGE, 403);
    }
    if (body.locale !== undefined) {
      if (!isAppLocale(body.locale)) {
        throw new ApiError("invalid_request", "locale must be en or id", 400);
      }
      saveOwnerLocale(body.locale);
    }
    // Keys pass through in both modes; only a blank is dropped in server mode, where it would
    // DELETE the key every tenant shares. `toolKeys`, `toolBackends` and `injectionGuardBypass`
    // never reach the patch in server mode — the check above proved none of them carries a value.
    const patch: SecretPatch = {
      openaiApiKey: keyFieldValue(body.openaiApiKey, serverMode),
      googleApiKey: keyFieldValue(body.googleApiKey, serverMode),
      anthropicApiKey: keyFieldValue(body.anthropicApiKey, serverMode),
      volcengineApiKey: keyFieldValue(body.volcengineApiKey, serverMode),
      toolKeys: serverMode ? undefined : readStringMap(body.toolKeys),
      toolBackends: serverMode ? undefined : readStringMap(body.toolBackends),
      imageGenModel: readOptionalString(body.imageGenModel),
      videoGenModel: readOptionalString(body.videoGenModel),
      musicGenModel: readOptionalString(body.musicGenModel),
      documentGenModel: readOptionalString(body.documentGenModel),
      researchGenModel: readOptionalString(body.researchGenModel),
      presentationGenModel: readOptionalString(body.presentationGenModel),
      disabledTools: readStringArray(body.disabledTools),
      injectionGuardBypass: serverMode ? undefined : readOptionalBoolean(body.injectionGuardBypass),
      editTurnCapUsd: readOptionalNumber(body.editTurnCapUsd),
    };
    const saved = saveSettings(patch, tenant);
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
      freshGate = await refreshGatewayGateAfterSave(body, saved, tenant);
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
    const tenant = await getTenant(request);
    applySavedLocaleAsBoot();
    return jsonOk(await settingsPayload(loadSettings(tenant), tenant));
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
  tenant: TenantContext,
): Promise<GatewayGatePayload | null> {
  if (typeof body.openaiApiKey !== "string") {
    return null;
  }
  if (body.openaiApiKey.trim().length === 0) {
    clearGateState(tenant);
    return null;
  }
  // The verdict this returns is the one the response carries. Re-deriving it from disk instead
  // would throw away the one case where the two differ: a verdict that was reached but could not
  // be written, which disk reads back as "never checked".
  return await runGatewayCheck(saved, { tenant });
}

export async function handleGatewayCheck(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const gateway = await runGatewayCheck(loadSettings(tenant), { tenant });
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
  // Phase 3 lane D: every non-local tenant's settings, verdict, usage, datasets, matters and
  // scratch live under here. "Start over" is refused in server mode, so on the desktop this is
  // normally absent; a webdev instance that resolved a second tenant is the case it covers.
  "tenants",
  "datasets",
  "edit",
  "legal",
  // Desk channels: the bot token lives in settings.enc, but the channel list and the stored
  // conversation are files here, and they are the host's own writes like everything else on this list.
  "channels",
  "models-cache.json",
  "models-dev-cache.json",
  // Downloaded native components (packages/host/src/components). Written by the host, inside the
  // data dir, and re-downloadable — so a full "Start over" drops it like everything else the host
  // wrote. The cost of being wrong here is one re-download, never data.
  "components",
  // The component installer's own diagnostics. Same reasoning; nothing in it is the owner's work.
  "logs",
] as const;

/** Reason code and message for a "Start over" that the hosted service does not offer. */
const RESET_DISABLED_CODE = "reset_disabled";
const RESET_DISABLED_MESSAGE =
  "Starting over is not available on the hosted service. Delete the desks, threads or files you no longer want instead.";

/**
 * "Forget my key" is machine-wide, not tenant-wide, so the hosted service cannot offer it either:
 * `clearGatewayKeyEverywhere` wipes the key out of every workspace slice on the box and
 * `clearGateState` throws away the one gate verdict they all share. One tenant pressing it would
 * sign every other tenant out of the gateway. Same refusal as "Start over", same reason code.
 */
const RESET_KEY_DISABLED_MESSAGE =
  "Signing out of the gateway is not available on the hosted service. The gateway key is managed by the operator.";

function resetGatewayKey(tenant: TenantContext, serverMode: boolean): HostResult {
  if (serverMode) {
    throw new ApiError(RESET_DISABLED_CODE, RESET_KEY_DISABLED_MESSAGE, 403);
  }
  // Every desk of this tenant: a key left on a second desk would keep the gate open after "forget
  // my key". Phase 3 lane D narrowed both calls from the whole install to the caller's tenant.
  clearGatewayKeyEverywhere(tenant);
  clearGateState(tenant);
  clearThisKeyCache();
  resetEmbedCircuit();
  resetJobModelCircuit();
  return jsonOk({
    ok: true,
    scope: "key",
    relaunch: false,
    resetPending: hasPendingDataReset(localDataDir()),
    gateway: reportGatewayGate(loadSettings(tenant), { tenant }),
  });
}

/**
 * "Start over" wipes the whole data dir, which on the hosted service is every tenant's work, not the
 * caller's (docs/internal/web-security-spec.md, row T8). Until it is scoped per tenant it is simply
 * off there. The refusal comes first, before the confirmation word and before anything is queued:
 * the owner of one workspace must not be able to arm a wipe for everyone else's.
 */
function resetEverything(tenant: TenantContext, confirm: string | undefined, serverMode: boolean): HostResult {
  if (serverMode) {
    throw new ApiError(RESET_DISABLED_CODE, RESET_DISABLED_MESSAGE, 403);
  }
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
    gateway: reportGatewayGate(loadSettings(tenant), { tenant }),
  });
}

/** Injectable so a test can ask for hosted behaviour without touching the process environment. */
export type ResetDeps = { isServerMode?: () => boolean };

export async function handleResetApp(request: HostRequest, deps: ResetDeps = {}): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const scope = readOptionalString(body.scope);
    const serverMode = deps.isServerMode ? deps.isServerMode() : isServerMode();
    if (scope === "key") {
      return resetGatewayKey(tenant, serverMode);
    }
    if (scope === "all") {
      return resetEverything(tenant, readOptionalString(body.confirm), serverMode);
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
export async function handleCancelReset(request: HostRequest, deps: ResetDeps = {}): Promise<HostResult> {
  try {
    await getTenant(request);
    // Symmetry with the two refusals above: the pending-reset marker is machine-wide, so one tenant
    // must not be able to reach it either way. Arming a wipe is already refused in server mode, so
    // this cannot fire on anything the hosted service itself queued — it closes the case where a
    // marker arrives another way (a restored data dir, a desk volume mounted on the server) and one
    // tenant quietly cancels a wipe the operator armed.
    if (deps.isServerMode ? deps.isServerMode() : isServerMode()) {
      throw new ApiError(RESET_DISABLED_CODE, RESET_DISABLED_MESSAGE, 403);
    }
    // `recursive` so that a directory left at the marker path — a botched restore, a sync client —
    // is cleared like anything else instead of throwing EISDIR and turning "cancel my wipe" into a
    // 500 the owner cannot get past.
    rmSync(pendingResetPath(localDataDir()), { force: true, recursive: true });
    return jsonOk({ ok: true, resetPending: false });
  } catch (error) {
    return jsonError(error);
  }
}
