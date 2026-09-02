import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SecretPatch, StoredSecrets } from "@agentforge/core";
import {
  assertAllowedEndpointUrl,
  decryptJson,
  encryptJson,
  isEnvelope,
  mergeSecrets,
} from "@agentforge/core";
import { getLocalVaultKey, localDataDir } from "@agentforge/db/vault-key";

export { getLocalVaultKey, localDataDir } from "@agentforge/db/vault-key";

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
    ? parsed.disabledTools.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
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
function persistEncrypted(secrets: StoredSecrets): void {
  const file = encryptedSettingsPath();
  mkdirSync(localDataDir(), { recursive: true });
  const envelope = encryptJson(secrets, getLocalVaultKey());
  writeFileSync(file, `${JSON.stringify(envelope)}\n`, "utf8");
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

function loadEncrypted(): StoredSecrets | null {
  try {
    const raw = readFileSync(encryptedSettingsPath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!isEnvelope(parsed)) {
      throw new Error("settings.enc is not a valid envelope");
    }
    return normalizeSecrets(decryptJson<StoredSecrets>(parsed, getLocalVaultKey()));
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    quarantineUnreadableSettings(error);
    return null;
  }
}

type SettingsCache = { path: string; mtimeMs: number; secrets: StoredSecrets };
let settingsCache: SettingsCache | null = null;

function rememberSettings(path: string, mtimeMs: number, secrets: StoredSecrets): StoredSecrets {
  settingsCache = { path, mtimeMs, secrets };
  return secrets;
}

export function loadSettings(): StoredSecrets {
  const file = encryptedSettingsPath();
  try {
    const stats = statSync(file);
    if (settingsCache && settingsCache.path === file && settingsCache.mtimeMs === stats.mtimeMs) {
      return settingsCache.secrets;
    }
    const encrypted = loadEncrypted();
    if (encrypted) {
      return rememberSettings(file, stats.mtimeMs, encrypted);
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
  settingsCache = null;
  const legacy = readLegacyPlaintext();
  if (!legacy) {
    return {};
  }
  persistEncrypted(legacy);
  tryDeleteLegacyPlaintext();
  try {
    const stats = statSync(file);
    return rememberSettings(file, stats.mtimeMs, legacy);
  } catch {
    return legacy;
  }
}

export function saveSettings(patch: SecretPatch): StoredSecrets {
  settingsCache = null;
  const next = mergeSecrets(loadSettings(), patch);
  assertSavedEndpoints(next);
  persistEncrypted(next);
  tryDeleteLegacyPlaintext();
  try {
    const file = encryptedSettingsPath();
    return rememberSettings(file, statSync(file).mtimeMs, next);
  } catch {
    return next;
  }
}
