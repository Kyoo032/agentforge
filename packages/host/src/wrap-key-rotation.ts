/**
 * Phase 4 — rotating the key that every tenant's secrets are sealed under.
 *
 * One wrap key (`AGENTFORGE_SECRETS_KEY`, or `.master-key` on a desk) encrypts every tenant's
 * `settings` payload through `packages/core/src/crypto/envelope.ts`. Until now there was no way to
 * change it: `vault-key.ts` deliberately refuses to re-mint a key it cannot verify, because doing
 * so silently would seal new secrets under a key the existing payloads were not sealed with. That
 * refusal is right, and it is also why rotation had to become a procedure rather than a side
 * effect. This module is that procedure, and `docs/internal/web-phase4-tenant-secrets.md` §5 is the
 * drill that runs it.
 *
 * **Decrypt everything before writing anything.** The rotation is a two-phase commit over tenants:
 * every payload is opened with the old key and re-sealed in memory first, and only if all of them
 * opened does anything get written. A key that is wrong for tenant 7 therefore costs nothing rather
 * than leaving tenants 1 to 6 sealed under the new key and 7 to 40 under the old one, which is a
 * state no single key can read and no second run can repair.
 *
 * **Verify after writing.** Each stored payload is read back and opened with the new key before the
 * run reports success, because "the write returned" and "the bytes can be decrypted" are different
 * claims and only the second one is worth anything here.
 *
 * What is NOT rotated, and does not need to be: the gate verdict (`gateway_gate`) is plain JSON
 * carrying a key fingerprint, never a key, so no wrap key opens or closes it.
 */
import { decryptJson, encryptJson, isEnvelope, wrappingKeyFromSecret } from "@agentforge/core";
import { decodeVaultKey, MIN_VAULT_KEY_BYTES, hasKeyLikeVariety } from "@agentforge/db/vault-key";
import { tenantStateBackend, type TenantStateBackend } from "./tenant-state-store";
import { log } from "./log";

/** The payload the wrap key seals. The other `TenantStateKey` holds no secret. */
const SETTINGS_KEY = "settings" as const;

export type RotateWrapKeyInput = {
  /** The secret the payloads are sealed under today, in the shapes `vault-key.ts` accepts. */
  from: string;
  /** The secret to seal them under. Refused unless it is at least as strong as `from` must be. */
  to: string;
  /** Open and re-seal everything, report, and write nothing. The rehearsal half of the drill. */
  dryRun?: boolean;
  /** Injected by the tests; defaults to the backend this process's mode selects. */
  backend?: TenantStateBackend;
};

export type RotateWrapKeyResult = {
  /** Tenants whose payload was re-sealed, or would have been on a dry run. */
  rotated: string[];
  /** Tenants that hold no sealed payload at all. Reported so a count can be reconciled. */
  skipped: string[];
  dryRun: boolean;
  backend: "file" | "db";
};

export class WrapKeyRotationError extends Error {
  readonly tenantId: string | null;

  constructor(message: string, tenantId: string | null = null) {
    super(message);
    this.name = "WrapKeyRotationError";
    this.tenantId = tenantId;
  }
}

/**
 * The same floor `getLocalVaultKey` enforces in server mode, applied to both keys here.
 *
 * Deliberately applied to `from` as well as to `to`: a rotation is the one moment when a weak key
 * that got onto a desk before this check existed can be replaced, and refusing to *read* it would
 * make that impossible. So `from` only has to be long enough to be a real key, while `to` must also
 * look generated — there is no reason to rotate onto a pattern.
 */
function assertUsableSecret(secret: string, label: string, requireVariety: boolean): void {
  const bytes = decodeVaultKey(secret);
  if (bytes.length < MIN_VAULT_KEY_BYTES) {
    throw new WrapKeyRotationError(
      `The ${label} wrap key is not a usable key: it must be at least ${MIN_VAULT_KEY_BYTES} random bytes, ` +
        "written as hex or canonical base64 exactly as `openssl rand -hex 32` produces them.",
    );
  }
  if (requireVariety && !hasKeyLikeVariety(bytes)) {
    throw new WrapKeyRotationError(
      `The ${label} wrap key is the right length but is not random: its bytes repeat far more than a ` +
        "generated key's ever would. Generate one with `openssl rand -hex 32`.",
    );
  }
}

type Resealed = { tenantId: string; value: string };

/**
 * Re-seal every tenant's settings payload from one wrap key to another.
 *
 * Returns which tenants were touched. Throws `WrapKeyRotationError` — before writing anything — if
 * either key is unusable or if any payload will not open under `from`.
 */
export function rotateWrapKey(input: RotateWrapKeyInput): RotateWrapKeyResult {
  assertUsableSecret(input.from, "current", false);
  assertUsableSecret(input.to, "new", true);
  if (input.from.trim() === input.to.trim()) {
    throw new WrapKeyRotationError("The new wrap key is the same as the current one; there is nothing to rotate.");
  }

  const backend = input.backend ?? tenantStateBackend();
  const oldKey = wrappingKeyFromSecret(input.from.trim());
  const newKey = wrappingKeyFromSecret(input.to.trim());

  const tenants = backend.tenantsWith(SETTINGS_KEY);
  const resealed: Resealed[] = [];
  const skipped: string[] = [];

  // Phase one: open everything. Nothing is written in this loop, on purpose.
  for (const tenantId of tenants) {
    const stored = backend.read(tenantId, SETTINGS_KEY);
    if (!stored) {
      // Listed a moment ago and gone now: a concurrent "start over", or a file removed by hand.
      skipped.push(tenantId);
      continue;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(stored.value);
    } catch (error) {
      throw new WrapKeyRotationError(
        `${backend.describe(tenantId, SETTINGS_KEY)} is not valid JSON, so it cannot be re-sealed: ${detail(error)}`,
        tenantId,
      );
    }
    if (!isEnvelope(envelope)) {
      throw new WrapKeyRotationError(
        `${backend.describe(tenantId, SETTINGS_KEY)} is not a sealed envelope, so it cannot be re-sealed.`,
        tenantId,
      );
    }
    let payload: unknown;
    try {
      payload = decryptJson<unknown>(envelope, oldKey);
    } catch {
      // The detail is deliberately not carried: a GCM failure says nothing useful and the message
      // would only invite someone to paste key material into an issue.
      throw new WrapKeyRotationError(
        `This tenant's settings do not open with the current wrap key, so NOTHING has been rotated. ` +
          "Check that --from is the key these settings were sealed with.",
        tenantId,
      );
    }
    resealed.push({ tenantId, value: `${JSON.stringify(encryptJson(payload, newKey))}\n` });
  }

  const rotated = resealed.map((entry) => entry.tenantId);
  if (input.dryRun) {
    log.info("wrap_key_rotation_dry_run", { backend: backend.kind, rotated: rotated.length, skipped: skipped.length });
    return { rotated, skipped, dryRun: true, backend: backend.kind };
  }

  // Phase two: write, then prove each write can be opened with the new key.
  for (const entry of resealed) {
    backend.write(entry.tenantId, SETTINGS_KEY, entry.value);
  }
  for (const entry of resealed) {
    const stored = backend.read(entry.tenantId, SETTINGS_KEY);
    const parsed: unknown = stored ? safeJson(stored.value) : null;
    if (!parsed || !isEnvelope(parsed)) {
      throw new WrapKeyRotationError(
        `${backend.describe(entry.tenantId, SETTINGS_KEY)} did not read back as a sealed envelope after rotation.`,
        entry.tenantId,
      );
    }
    try {
      decryptJson<unknown>(parsed, newKey);
    } catch {
      throw new WrapKeyRotationError(
        `${backend.describe(entry.tenantId, SETTINGS_KEY)} was written but does not open with the new wrap key.`,
        entry.tenantId,
      );
    }
  }

  log.info("wrap_key_rotated", { backend: backend.kind, rotated: rotated.length, skipped: skipped.length });
  return { rotated, skipped, dryRun: false, backend: backend.kind };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
