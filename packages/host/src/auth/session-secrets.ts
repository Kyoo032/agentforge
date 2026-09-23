/**
 * The portal refresh token at rest, one sealed blob per browser session.
 *
 * Owner decision, 2026-09-23: the refresh token behind a hosted session is kept encrypted in the
 * host database (`auth_sessions.refresh_sealed`, migration 0021) so a restart or a deploy signs
 * nobody out. Until then the token lived in process memory only and every restart ended every
 * session at its next portal check. The access token is still never written anywhere: it lives an
 * hour, and a cold start simply refreshes.
 *
 * THE KEY. Not the wrap key itself: a key derived from it for this purpose alone, HKDF-SHA256 with
 * an empty salt and info `auth-session-refresh-v1`, 32 bytes. That is the shape the device-code
 * design gives the desktop's `session.enc` (`HKDF(wrapKey, "session-v1")`,
 * docs/internal/portal/device-code-login.md:447), with its own label so neither purpose's key opens
 * the other's blobs. The envelope is the repo's one AES-256-GCM format
 * (`packages/core/src/crypto/envelope.ts`).
 *
 * THE BINDING. The sealed payload carries the id digest of the row it was sealed for, and a blob
 * only opens as that row. Moving a sealed token to another session's row — the one thing someone
 * with write access to the table but not the key could try — gets nothing.
 *
 * FAILURE IS A VALUE. `openRefresh` answers `null` for anything that does not open as this
 * session's token under this key: another key (a wrap key changed without the rotation drill), a
 * corrupt or truncated blob, a foreign row's blob. The caller ends the session cleanly on that. A
 * wrap key that cannot be read at all is different — a deployment fault, not a verdict on the
 * session — so `createSessionSecrets` lets that throw.
 */
import { hkdfSync } from "node:crypto";
import { decryptJson, encryptJson, isEnvelope } from "@agentforge/core";
import { hashSessionId } from "./session";

/** The HKDF info label. Changing it orphans every stored token: bump the suffix, never edit it. */
export const REFRESH_SEALING_INFO = "auth-session-refresh-v1";
const SEALING_KEY_BYTES = 32;
const NO_SALT = Buffer.alloc(0);
const PAYLOAD_VERSION = 1;

/** What survives a restart: enough to present to the portal, and nothing else. */
export type StoredRefresh = {
  readonly refreshToken: string;
  readonly deviceId: string | null;
};

type SealedPayload = {
  readonly v: typeof PAYLOAD_VERSION;
  /** The id digest of the `auth_sessions` row this was sealed for. */
  readonly sid: string;
  readonly refreshToken: string;
  readonly deviceId: string | null;
};

/** HKDF-SHA256(wrapKey, salt = "", info = `auth-session-refresh-v1`), 32 bytes. */
export function refreshSealingKey(wrapKey: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", wrapKey, NO_SALT, REFRESH_SEALING_INFO, SEALING_KEY_BYTES));
}

/** The string stored in `auth_sessions.refresh_sealed` for the row whose id digest is `sessionIdHash`. */
export function sealRefresh(sessionIdHash: string, tokens: StoredRefresh, wrapKey: Buffer): string {
  const payload: SealedPayload = {
    v: PAYLOAD_VERSION,
    sid: sessionIdHash,
    refreshToken: tokens.refreshToken,
    deviceId: tokens.deviceId,
  };
  return JSON.stringify(encryptJson(payload, refreshSealingKey(wrapKey)));
}

function isSealedPayload(value: unknown): value is SealedPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.v === PAYLOAD_VERSION &&
    typeof record.sid === "string" &&
    typeof record.refreshToken === "string" &&
    record.refreshToken.length > 0 &&
    (record.deviceId === null || typeof record.deviceId === "string")
  );
}

/** The token sealed for this row under this wrap key, or null for anything else. Never throws. */
export function openRefresh(sessionIdHash: string, sealed: string, wrapKey: Buffer): StoredRefresh | null {
  let envelope: unknown;
  try {
    envelope = JSON.parse(sealed);
  } catch {
    return null;
  }
  if (!isEnvelope(envelope)) {
    return null;
  }
  let payload: unknown;
  try {
    payload = decryptJson<unknown>(envelope, refreshSealingKey(wrapKey));
  } catch {
    return null;
  }
  if (!isSealedPayload(payload) || payload.sid !== sessionIdHash) {
    return null;
  }
  return { refreshToken: payload.refreshToken, deviceId: payload.deviceId };
}

/** What the auth routes and the portal check hold: seal and open by the cookie's id. */
export interface SessionSecrets {
  seal(sessionId: string, tokens: StoredRefresh): string;
  /** Null when the blob does not open; throws only when the wrap key itself cannot be read. */
  open(sessionId: string, sealed: string): StoredRefresh | null;
}

/**
 * Under whatever `wrapKey()` answers at the moment of the call, so a process never caches a key the
 * environment has since moved away from. On the hosted server that is `getLocalVaultKey()`, i.e.
 * `AGENTFORGE_SECRETS_KEY`, which the boot check (`../hosted-env.ts`) has already proved usable.
 */
export function createSessionSecrets(wrapKey: () => Buffer): SessionSecrets {
  return {
    seal: (sessionId, tokens) => sealRefresh(hashSessionId(sessionId), tokens, wrapKey()),
    open: (sessionId, sealed) => openRefresh(hashSessionId(sessionId), sealed, wrapKey()),
  };
}
