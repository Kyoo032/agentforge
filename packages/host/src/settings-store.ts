import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppLocale, SecretPatch, StoredSecrets, TenantContext } from "@agentforge/core";
import {
  ApiError,
  LOCAL_TENANT_ID,
  resolvedGatewayBaseUrl,
  assertAllowedEndpointUrl,
  decryptJson,
  encryptJson,
  isAppLocale,
  isEnvelope,
  isGatewayBaseUrl,
  isServerMode,
  knowledgeBackendSetting,
  mergeSecrets,
  parseAppLocale,
} from "@agentforge/core";
import { getLocalVaultKey } from "@agentforge/db/vault-key";
import { readSelectedWorkspaceId } from "./workspace";
import { assertTenantId, tenantDataDir } from "./tenant-paths";
import { log } from "./log";

export { getLocalVaultKey, localDataDir } from "@agentforge/db/vault-key";

/** Machine-wide v1 payload, claimed onto Default on first boot after upgrade. */
export const LEGACY_SETTINGS_WORKSPACE = "__legacy__";
/** Used only when no desk is selected (unit tests, first boot). */
export const FALLBACK_SETTINGS_WORKSPACE = "__default__";

/**
 * Phase 3 lane D — whose settings a call is about.
 *
 * A `TenantContext` names both the tenant and the desk. A bare string (or nothing) is the
 * pre-Phase-3 spelling and means "this desk, on the local tenant": correct on the desktop and on
 * webdev, and **refused in server mode**, where a call that cannot name its tenant must not fall
 * back to somebody else's file. `packages/host/src/handlers` is swept to the tenant form; the
 * remaining bare-string callers are listed in `docs/internal/web-phase3-lane-d.md`.
 */
export type SettingsScope = Pick<TenantContext, "tenantId" | "workspaceId"> | string | null | undefined;

export type ResolvedSettingsScope = { tenantId: string; workspaceId: string };

export function resolveSettingsScope(scope?: SettingsScope): ResolvedSettingsScope {
  if (scope && typeof scope === "object") {
    return { tenantId: assertTenantId(scope.tenantId), workspaceId: resolveSettingsWorkspaceId(scope.workspaceId) };
  }
  if (isServerMode()) {
    throw new ApiError(
      "tenant_required",
      "This request reached the settings store without a tenant. Hosted requests must pass the tenant, never a bare desk id.",
      500,
    );
  }
  return { tenantId: LOCAL_TENANT_ID, workspaceId: resolveSettingsWorkspaceId(scope) };
}

/** `<dataDir>/settings.enc` for the local tenant; under `tenants/<tenantId>/` for anyone else. */
function encryptedSettingsPath(tenantId: string): string {
  return resolve(tenantDataDir(tenantId), "settings.enc");
}

function legacySettingsPath(tenantId: string): string {
  return resolve(tenantDataDir(tenantId), "settings.json");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && item.trim().length > 0) {
      next[key] = item.trim();
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeSecrets(parsed: StoredSecrets): StoredSecrets {
  const disabledTools = Array.isArray(parsed.disabledTools)
    ? parsed.disabledTools
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
    : undefined;
  return {
    openaiApiKey: readString(parsed.openaiApiKey),
    googleApiKey: readString(parsed.googleApiKey),
    anthropicApiKey: readString(parsed.anthropicApiKey),
    volcengineApiKey: readString(parsed.volcengineApiKey),
    openaiBaseUrl: readString(parsed.openaiBaseUrl),
    googleBaseUrl: readString(parsed.googleBaseUrl),
    anthropicBaseUrl: readString(parsed.anthropicBaseUrl),
    volcengineBaseUrl: readString(parsed.volcengineBaseUrl),
    toolKeys: readStringMap(parsed.toolKeys),
    toolBackends: readStringMap(parsed.toolBackends),
    imageGenModel: readString(parsed.imageGenModel),
    videoGenModel: readString(parsed.videoGenModel),
    documentGenModel: readString(parsed.documentGenModel),
    researchGenModel: readString(parsed.researchGenModel),
    presentationGenModel: readString(parsed.presentationGenModel),
    disabledTools,
    injectionGuardBypass: parsed.injectionGuardBypass === true ? true : undefined,
    editTurnCapUsd:
      typeof parsed.editTurnCapUsd === "number" && Number.isFinite(parsed.editTurnCapUsd)
        ? Math.min(50, Math.max(0.5, parsed.editTurnCapUsd))
        : undefined,
    // An unknown id on disk (an older / newer build, a hand-edited file) reads as absent, which
    // means builtin: a desk can never be locked out of retrieval by a value nothing can serve.
    knowledgeBackend: knowledgeBackendSetting(parsed.knowledgeBackend),
    weknoraApiKey: readString(parsed.weknoraApiKey),
    weknoraTenantId: readString(parsed.weknoraTenantId),
    weknoraAesKey: readString(parsed.weknoraAesKey),
    weknoraJwtSecret: readString(parsed.weknoraJwtSecret),
    weknoraRevokedModelIds: readString(parsed.weknoraRevokedModelIds),
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function readLegacyPlaintext(tenantId: string): StoredSecrets | null {
  try {
    const raw = readFileSync(legacySettingsPath(tenantId), "utf8");
    return normalizeSecrets(JSON.parse(raw) as StoredSecrets);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    return null;
  }
}

function tryDeleteLegacyPlaintext(tenantId: string): void {
  const path = legacySettingsPath(tenantId);
  if (!existsSync(path)) {
    return;
  }
  try {
    unlinkSync(path);
  } catch {
    log.warn("settings_legacy_json_not_deleted", { path });
  }
}
type SettingsFileV2 = {
  version: 2;
  locale?: AppLocale;
  workspaces: Record<string, StoredSecrets>;
};

/**
 * Keyed by path, not a single slot: two tenants alternating requests would otherwise evict each
 * other on every call and re-decrypt the file each time.
 */
type FileCache = { mtimeMs: number; file: SettingsFileV2 };
const fileCache = new Map<string, FileCache>();

function emptySettingsFile(): SettingsFileV2 {
  return { version: 2, workspaces: {} };
}

function isSettingsFileV2(value: unknown): value is SettingsFileV2 {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { version?: unknown; workspaces?: unknown };
  return (
    record.version === 2 &&
    record.workspaces !== null &&
    typeof record.workspaces === "object" &&
    !Array.isArray(record.workspaces)
  );
}

function secretsMap(workspaces: Record<string, unknown>): Record<string, StoredSecrets> {
  const next: Record<string, StoredSecrets> = {};
  for (const [id, value] of Object.entries(workspaces)) {
    if (value && typeof value === "object") {
      next[id] = normalizeSecrets(value as StoredSecrets);
    }
  }
  return next;
}

function readLocaleField(value: unknown): AppLocale | undefined {
  return isAppLocale(value) ? value : undefined;
}

function parseSettingsFile(decrypted: unknown): { file: SettingsFileV2; migrated: boolean } {
  if (isSettingsFileV2(decrypted)) {
    return {
      file: {
        version: 2,
        locale: readLocaleField((decrypted as SettingsFileV2).locale),
        workspaces: secretsMap(decrypted.workspaces as Record<string, unknown>),
      },
      migrated: false,
    };
  }
  if (decrypted && typeof decrypted === "object") {
    return {
      file: { version: 2, workspaces: { [LEGACY_SETTINGS_WORKSPACE]: normalizeSecrets(decrypted as StoredSecrets) } },
      migrated: true,
    };
  }
  return { file: emptySettingsFile(), migrated: false };
}

function persistEncrypted(tenantId: string, file: SettingsFileV2): void {
  const path = encryptedSettingsPath(tenantId);
  // The vault key stays machine-wide (`vault-key.ts`): Phase 3 splits the file per tenant, Phase 4
  // swaps the backend behind this same interface (spec §3e).
  mkdirSync(tenantDataDir(tenantId), { recursive: true });
  const envelope = encryptJson(file, getLocalVaultKey());
  writeFileSync(path, `${JSON.stringify(envelope)}\n`, "utf8");
  fileCache.delete(path);
}

export function resolveSettingsWorkspaceId(workspaceId?: string | null): string {
  const explicit = workspaceId?.trim();
  if (explicit) {
    return explicit;
  }
  return readSelectedWorkspaceId() ?? FALLBACK_SETTINGS_WORKSPACE;
}

function sliceFor(file: SettingsFileV2, workspaceId: string): StoredSecrets {
  const own = file.workspaces[workspaceId];
  if (own) {
    return own;
  }
  if (workspaceId === FALLBACK_SETTINGS_WORKSPACE && file.workspaces[LEGACY_SETTINGS_WORKSPACE]) {
    return file.workspaces[LEGACY_SETTINGS_WORKSPACE]!;
  }
  return {};
}

function assertSavedEndpoints(secrets: StoredSecrets): void {
  for (const url of [
    secrets.openaiBaseUrl,
    secrets.googleBaseUrl,
    secrets.anthropicBaseUrl,
    secrets.volcengineBaseUrl,
  ]) {
    if (url) {
      assertAllowedEndpointUrl(url);
    }
  }
}

function quarantineUnreadableSettings(tenantId: string, reason: unknown): void {
  const file = encryptedSettingsPath(tenantId);
  if (!existsSync(file)) {
    return;
  }
  const aside = `${file}.unreadable`;
  try {
    renameSync(file, aside);
    log.warn("settings_enc_moved_aside", {
      path: aside,
      detail: reason instanceof Error ? reason.message : reason,
    });
  } catch (moveError) {
    log.warn("settings_enc_not_moved_aside", {
      detail: reason instanceof Error ? reason.message : reason,
      moveDetail: moveError instanceof Error ? moveError.message : moveError,
    });
  }
}

function loadEncryptedPayload(tenantId: string): unknown | null {
  try {
    const raw = readFileSync(encryptedSettingsPath(tenantId), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) {
      throw new Error("settings.enc is not a valid envelope");
    }
    return decryptJson<unknown>(parsed, getLocalVaultKey());
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    quarantineUnreadableSettings(tenantId, error);
    return null;
  }
}

function normalizeEndpoint(url: string | undefined): string | undefined {
  const trimmed = url?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

/** Logged at most once per process: a repeat on every settings read would be noise, not signal. */
let warnedStoredGatewayEndpoint = false;

/**
 * The gateway endpoint is pinned (`core/gateway/pinned.ts`) and Settings no longer accepts the field. A
 * value left behind by an older build - or written into `settings.enc` by hand - is discarded here, on
 * both the load and the save path, so no caller can be handed a host that would receive the gateway key.
 * The warning names no URL: it would be echoing back an attacker-controlled field.
 */
function withGatewayDefault(secrets: StoredSecrets): StoredSecrets {
  const stored = normalizeEndpoint(secrets.openaiBaseUrl);
  if (stored && !isGatewayBaseUrl(stored) && !warnedStoredGatewayEndpoint) {
    warnedStoredGatewayEndpoint = true;
    log.warn("settings_stored_gateway_endpoint_ignored");
  }
  return { ...secrets, openaiBaseUrl: resolvedGatewayBaseUrl() };
}

function rememberFile(path: string, mtimeMs: number, file: SettingsFileV2): SettingsFileV2 {
  fileCache.set(path, { mtimeMs, file });
  return file;
}

function loadSettingsFile(tenantId: string): SettingsFileV2 {
  const path = encryptedSettingsPath(tenantId);
  try {
    const stats = statSync(path);
    const cached = fileCache.get(path);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.file;
    }
    const payload = loadEncryptedPayload(tenantId);
    if (payload != null) {
      const parsed = parseSettingsFile(payload);
      if (parsed.migrated) {
        persistEncrypted(tenantId, parsed.file);
        try {
          return rememberFile(path, statSync(path).mtimeMs, parsed.file);
        } catch {
          return parsed.file;
        }
      }
      return rememberFile(path, stats.mtimeMs, parsed.file);
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  fileCache.delete(path);
  const legacy = readLegacyPlaintext(tenantId);
  if (!legacy) {
    return emptySettingsFile();
  }
  const migrated: SettingsFileV2 = {
    version: 2,
    workspaces: { [LEGACY_SETTINGS_WORKSPACE]: legacy },
  };
  persistEncrypted(tenantId, migrated);
  tryDeleteLegacyPlaintext(tenantId);
  try {
    return rememberFile(path, statSync(path).mtimeMs, migrated);
  } catch {
    return migrated;
  }
}

export function loadSettings(scope?: SettingsScope): StoredSecrets {
  const { tenantId, workspaceId } = resolveSettingsScope(scope);
  return withGatewayDefault(sliceFor(loadSettingsFile(tenantId), workspaceId));
}

export function saveSettings(patch: SecretPatch, scope?: SettingsScope): StoredSecrets {
  const { tenantId, workspaceId } = resolveSettingsScope(scope);
  const file = loadSettingsFile(tenantId);
  const next = withGatewayDefault(mergeSecrets(sliceFor(file, workspaceId), patch));
  assertSavedEndpoints(next);
  persistEncrypted(tenantId, {
    version: 2,
    locale: file.locale,
    workspaces: { ...file.workspaces, [workspaceId]: next },
  });
  tryDeleteLegacyPlaintext(tenantId);
  return next;
}

/**
 * Move a pre-isolation machine-wide key onto Default. Other desks stay empty until the owner pastes a key there.
 */
export function adoptLegacySettings(homeWorkspaceId: string): void {
  const id = homeWorkspaceId.trim();
  if (!id) {
    return;
  }
  // Desktop upgrade path only. `LEGACY_SETTINGS_WORKSPACE` is a v1 machine-wide payload, which only
  // a pre-v2 desktop install has; a hosted tenant's file starts at v2 and never carries one. Called
  // from `getTenant` on every request, so in server mode it must be a no-op rather than a throw.
  if (isServerMode()) {
    return;
  }
  const file = loadSettingsFile(LOCAL_TENANT_ID);
  const legacy = file.workspaces[LEGACY_SETTINGS_WORKSPACE];
  if (!legacy) {
    return;
  }
  const rest = { ...file.workspaces };
  delete rest[LEGACY_SETTINGS_WORKSPACE];
  if (!rest[id]) {
    rest[id] = legacy;
  }
  persistEncrypted(LOCAL_TENANT_ID, { version: 2, locale: file.locale, workspaces: rest });
}

/**
 * "Start over — key only": drop the gateway key from every desk **of one tenant** in one write.
 *
 * A key saved on a second desk would otherwise keep the app open after the owner asked to forget
 * it, so this covers every desk — but only the caller's tenant, which is what makes it safe to
 * reach in server mode at all. Returns the desks that actually held a key.
 */
export function clearGatewayKeyEverywhere(scope?: SettingsScope): string[] {
  const { tenantId } = resolveSettingsScope(scope);
  const file = loadSettingsFile(tenantId);
  const touched: string[] = [];
  const workspaces: Record<string, StoredSecrets> = {};
  for (const [id, slice] of Object.entries(file.workspaces)) {
    if (slice.openaiApiKey) {
      touched.push(id);
    }
    workspaces[id] = mergeSecrets(slice, { openaiApiKey: "" });
  }
  if (touched.length === 0) {
    return [];
  }
  persistEncrypted(tenantId, { version: 2, locale: file.locale, workspaces });
  return touched;
}

export function dropWorkspaceSettings(workspaceId: string, scope?: SettingsScope): void {
  const id = workspaceId.trim();
  if (!id) {
    return;
  }
  const { tenantId } = resolveSettingsScope(scope ?? workspaceId);
  const file = loadSettingsFile(tenantId);
  if (!file.workspaces[id]) {
    return;
  }
  const rest = { ...file.workspaces };
  delete rest[id];
  persistEncrypted(tenantId, { version: 2, locale: file.locale, workspaces: rest });
}

/**
 * Machine-wide UI locale. Not a per-desk secret, and **deliberately not per tenant either**: the
 * host process freezes one boot locale (`locale-boot.ts:11-16`) that every copy catalogue and every
 * `localeForRun()` reads, so a per-tenant value would be stored and never applied. It therefore
 * stays in the local tenant's file, exactly where it is today. Making the locale per tenant means
 * threading it through `run-context.ts`; that is listed as an open item in
 * `docs/internal/web-phase3-lane-d.md`, not silently half-done here.
 */
export function loadOwnerLocale(): AppLocale {
  return parseAppLocale(loadSettingsFile(LOCAL_TENANT_ID).locale);
}

export function saveOwnerLocale(locale: AppLocale): AppLocale {
  const file = loadSettingsFile(LOCAL_TENANT_ID);
  persistEncrypted(LOCAL_TENANT_ID, { version: 2, locale, workspaces: file.workspaces });
  return locale;
}

/** Test seam: forget every decrypted file so a suite can rewrite the data dir underneath. */
export function resetSettingsCacheForTests(): void {
  fileCache.clear();
}
