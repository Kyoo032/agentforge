import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SecretPatch, StoredSecrets } from "@agentforge/core";
import {
  resolvedGatewayBaseUrl,
  assertAllowedEndpointUrl,
  decryptJson,
  encryptJson,
  isEnvelope,
  mergeSecrets,
} from "@agentforge/core";
import { getLocalVaultKey, localDataDir } from "@agentforge/db/vault-key";
import { readSelectedWorkspaceId } from "./workspace";

export { getLocalVaultKey, localDataDir } from "@agentforge/db/vault-key";

/** Machine-wide v1 payload, claimed onto Default on first boot after upgrade. */
export const LEGACY_SETTINGS_WORKSPACE = "__legacy__";
/** Used only when no desk is selected (unit tests, first boot). */
export const FALLBACK_SETTINGS_WORKSPACE = "__default__";

function encryptedSettingsPath(): string {
  return resolve(localDataDir(), "settings.enc");
}

function legacySettingsPath(): string {
  return resolve(localDataDir(), "settings.json");
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
  };
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function readLegacyPlaintext(): StoredSecrets | null {
  try {
    const raw = readFileSync(legacySettingsPath(), "utf8");
    return normalizeSecrets(JSON.parse(raw) as StoredSecrets);
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    return null;
  }
}

function tryDeleteLegacyPlaintext(): void {
  if (!existsSync(legacySettingsPath())) {
    return;
  }
  try {
    unlinkSync(legacySettingsPath());
  } catch {
    console.warn(
      "[agentforge] Could not delete leftover settings.json. API keys may still be in plaintext at",
      legacySettingsPath(),
    );
  }
}
type SettingsFileV2 = {
  version: 2;
  workspaces: Record<string, StoredSecrets>;
};

type FileCache = { path: string; mtimeMs: number; file: SettingsFileV2 };
let fileCache: FileCache | null = null;

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

function parseSettingsFile(decrypted: unknown): { file: SettingsFileV2; migrated: boolean } {
  if (isSettingsFileV2(decrypted)) {
    return { file: { version: 2, workspaces: secretsMap(decrypted.workspaces as Record<string, unknown>) }, migrated: false };
  }
  if (decrypted && typeof decrypted === "object") {
    return {
      file: { version: 2, workspaces: { [LEGACY_SETTINGS_WORKSPACE]: normalizeSecrets(decrypted as StoredSecrets) } },
      migrated: true,
    };
  }
  return { file: emptySettingsFile(), migrated: false };
}

function persistEncrypted(file: SettingsFileV2): void {
  const path = encryptedSettingsPath();
  mkdirSync(localDataDir(), { recursive: true });
  const envelope = encryptJson(file, getLocalVaultKey());
  writeFileSync(path, `${JSON.stringify(envelope)}\n`, "utf8");
  fileCache = null;
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

function quarantineUnreadableSettings(reason: unknown): void {
  const file = encryptedSettingsPath();
  if (!existsSync(file)) {
    return;
  }
  const aside = `${file}.unreadable`;
  try {
    renameSync(file, aside);
    console.warn(
      "[agentforge] settings.enc could not be decrypted (wrap key changed or file is corrupt). Moved aside to",
      aside,
      reason instanceof Error ? reason.message : reason,
    );
  } catch (moveError) {
    console.warn(
      "[agentforge] settings.enc could not be decrypted and could not be moved aside.",
      reason instanceof Error ? reason.message : reason,
      moveError instanceof Error ? moveError.message : moveError,
    );
  }
}

function loadEncryptedPayload(): unknown | null {
  try {
    const raw = readFileSync(encryptedSettingsPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) {
      throw new Error("settings.enc is not a valid envelope");
    }
    return decryptJson<unknown>(parsed, getLocalVaultKey());
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    quarantineUnreadableSettings(error);
    return null;
  }
}

function normalizeEndpoint(url: string | undefined): string | undefined {
  const trimmed = url?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : undefined;
}

/**
 * The gateway endpoint defaults to the branded gateway (Toko Token, or the flavor's URL) but the owner may
 * point it elsewhere from Settings. An empty value means "back to the default". Onboarding never edits it.
 */
function withGatewayDefault(secrets: StoredSecrets): StoredSecrets {
  return { ...secrets, openaiBaseUrl: normalizeEndpoint(secrets.openaiBaseUrl) ?? resolvedGatewayBaseUrl() };
}

function rememberFile(path: string, mtimeMs: number, file: SettingsFileV2): SettingsFileV2 {
  fileCache = { path, mtimeMs, file };
  return file;
}

function loadSettingsFile(): SettingsFileV2 {
  const path = encryptedSettingsPath();
  try {
    const stats = statSync(path);
    if (fileCache && fileCache.path === path && fileCache.mtimeMs === stats.mtimeMs) {
      return fileCache.file;
    }
    const payload = loadEncryptedPayload();
    if (payload != null) {
      const parsed = parseSettingsFile(payload);
      if (parsed.migrated) {
        persistEncrypted(parsed.file);
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
  fileCache = null;
  const legacy = readLegacyPlaintext();
  if (!legacy) {
    return emptySettingsFile();
  }
  const migrated: SettingsFileV2 = {
    version: 2,
    workspaces: { [LEGACY_SETTINGS_WORKSPACE]: legacy },
  };
  persistEncrypted(migrated);
  tryDeleteLegacyPlaintext();
  try {
    return rememberFile(path, statSync(path).mtimeMs, migrated);
  } catch {
    return migrated;
  }
}

export function loadSettings(workspaceId?: string | null): StoredSecrets {
  const id = resolveSettingsWorkspaceId(workspaceId);
  return withGatewayDefault(sliceFor(loadSettingsFile(), id));
}

export function saveSettings(patch: SecretPatch, workspaceId?: string | null): StoredSecrets {
  const id = resolveSettingsWorkspaceId(workspaceId);
  const file = loadSettingsFile();
  const next = withGatewayDefault(mergeSecrets(sliceFor(file, id), patch));
  assertSavedEndpoints(next);
  persistEncrypted({
    version: 2,
    workspaces: { ...file.workspaces, [id]: next },
  });
  tryDeleteLegacyPlaintext();
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
  const file = loadSettingsFile();
  const legacy = file.workspaces[LEGACY_SETTINGS_WORKSPACE];
  if (!legacy) {
    return;
  }
  const rest = { ...file.workspaces };
  delete rest[LEGACY_SETTINGS_WORKSPACE];
  if (!rest[id]) {
    rest[id] = legacy;
  }
  persistEncrypted({ version: 2, workspaces: rest });
}

export function dropWorkspaceSettings(workspaceId: string): void {
  const id = workspaceId.trim();
  if (!id) {
    return;
  }
  const file = loadSettingsFile();
  if (!file.workspaces[id]) {
    return;
  }
  const rest = { ...file.workspaces };
  delete rest[id];
  persistEncrypted({ version: 2, workspaces: rest });
}
