import { randomBytes, randomInt } from "node:crypto";
import { loadSettings, saveSettings } from "../../../settings-store";

/**
 * The sidecar's own credentials, generated on this machine and never sent anywhere but loopback.
 *
 * They live in one fixed settings slice rather than the selected desk's, because the sidecar is
 * machine-wide: one process, one tenant, one API key, and *then* one knowledge base per agentforge
 * workspace (tracked in `knowledge_workspace_backend`). Filing them under whichever desk happened
 * to be open when the owner flipped the flag would make a second desk try to bootstrap a second
 * tenant against a server that has registration disabled.
 */
export const WEKNORA_SETTINGS_WORKSPACE = "__weknora__";

/** WeKnora's `TENANT_AES_KEY` is used as a raw AES-256 key, so it must be exactly 32 characters. */
export const AES_KEY_CHARS = 32;

/**
 * The alphabet the AES key is drawn from.
 *
 * Upstream takes the *bytes of the string* as the key, and refuses anything that is not exactly 32
 * characters long — so the 32 characters are the entire key and every bit of entropy has to fit
 * inside them. Hex spends two characters per byte, which turned 32 characters into 16 bytes of
 * randomness: an AES-256 key with 128 bits in it. Base62 gets ~5.95 bits per character, so the same
 * 32 characters carry ~190 bits. Restricted to ASCII alphanumerics deliberately: the value travels
 * through an environment variable into a Go process, and quoting rules are not worth the risk.
 */
const AES_KEY_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export type WeKnoraSecrets = {
  /** Encrypts the model API keys the sidecar stores in its own database. */
  aesKey: string;
  jwtSecret: string;
  /** Long-lived key minted by bootstrap; absent until the first successful auto-setup. */
  apiKey?: string;
  tenantId?: string;
};

/** 32 base62 characters, each drawn uniformly with `crypto.randomInt` (no modulo bias). */
function generatedAesKey(): string {
  let key = "";
  for (let index = 0; index < AES_KEY_CHARS; index += 1) {
    key += AES_KEY_ALPHABET[randomInt(AES_KEY_ALPHABET.length)];
  }
  return key;
}

function generatedJwtSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * The sidecar secrets, minting and persisting the two the process needs to boot when they are not
 * there yet. Idempotent: a second call returns the same key, or the sidecar's stored model keys
 * would become undecryptable on the next restart.
 */
export function loadWeknoraSecrets(): WeKnoraSecrets {
  const stored = loadSettings(WEKNORA_SETTINGS_WORKSPACE);
  const aesKey = usableAesKey(stored.weknoraAesKey) ?? generatedAesKey();
  const jwtSecret = stored.weknoraJwtSecret?.trim() || generatedJwtSecret();
  if (aesKey !== stored.weknoraAesKey || jwtSecret !== stored.weknoraJwtSecret) {
    saveSettings({ weknoraAesKey: aesKey, weknoraJwtSecret: jwtSecret }, WEKNORA_SETTINGS_WORKSPACE);
  }
  return {
    aesKey,
    jwtSecret,
    apiKey: stored.weknoraApiKey,
    tenantId: stored.weknoraTenantId,
  };
}

/** A stored key of the wrong length is replaced: the sidecar refuses to start on a short one. */
function usableAesKey(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === AES_KEY_CHARS ? trimmed : null;
}

/** Record the tenant and long-lived key that bootstrap minted. */
export function saveWeknoraCredentials(input: { apiKey: string; tenantId: string }): void {
  saveSettings({ weknoraApiKey: input.apiKey, weknoraTenantId: input.tenantId }, WEKNORA_SETTINGS_WORKSPACE);
}

/**
 * Forget the tenant and key, keeping the AES / JWT secrets. Used when the sidecar answers 401 with
 * a key it minted itself — its database was reset under us, so the next call re-runs auto-setup.
 */
export function clearWeknoraCredentials(): void {
  saveSettings({ weknoraApiKey: "", weknoraTenantId: "" }, WEKNORA_SETTINGS_WORKSPACE);
}
