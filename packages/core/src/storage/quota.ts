/**
 * Phase 6 — the per-tenant storage quota, as arithmetic with no database and no filesystem.
 *
 * Everything here is pure, for the same reason `entitlement/types.ts` is pure: the rule that
 * decides whether a tenant may store another 40 MB should be readable and testable without a
 * SQLite file, a COS bucket or a data directory. `packages/host/src/tenant-storage.ts` is the IO
 * around it.
 *
 * **Three decisions live in this file.**
 *
 * 1. *What the limit is.* A configuration value in bytes (`AGENTFORGE_TENANT_STORAGE_BYTES`) with a
 *    default, not a per-tenant column. Phase 5 already owns per-tenant commercial limits in
 *    `tenant_plan`; a second, storage-shaped entitlement would need its own webhook, its own
 *    top-up path and its own reconciliation, and none of that exists yet. One number per
 *    deployment is the honest shape for what this phase can actually enforce, and moving it onto
 *    the plan row later changes this function and nothing else.
 *
 * 2. *Who it applies to.* Server mode only, by construction. A desktop install's disk is the
 *    owner's own disk: refusing their import because a hosted default says 20 GB would be a
 *    regression invented by a multi-tenancy phase they are not part of. Off server mode
 *    `tenantStorageLimitBytes` returns `null`, which means "measure and report, refuse nothing".
 *
 * 3. *What a refusal is called.* `storage_quota_exceeded`, never `gateway_blocked` — the same rule
 *    Phase 5 lane B set for `plan_*` (`entitlement/types.ts:44-54`). `gateway_blocked` sends the
 *    renderer to the paste-your-key onboarding screen, which is a dead end for a hosted tenant who
 *    holds no key and whose actual problem is that their bucket prefix is full.
 */

import type { EnvLike } from "../server-mode";
import { isServerMode } from "../server-mode";

/**
 * The default ceiling for one tenant's bytes on a hosted deployment: 20 GiB.
 *
 * Sized against the CVM the Tencent runbook specifies — a 200 GB data disk and a COS media bucket
 * (`docs/internal/tencent-cvm-setup.md` §4, §5) — so that the first handful of tenants cannot fill
 * the box between two checks of the console. It is a starting point an operator is expected to
 * raise per deployment, not a product promise.
 */
export const DEFAULT_TENANT_STORAGE_BYTES = 20 * 1024 * 1024 * 1024;

/** The environment variable that overrides it. Bytes, as an integer. */
export const TENANT_STORAGE_BYTES_ENV = "AGENTFORGE_TENANT_STORAGE_BYTES";

/**
 * Spellings that mean "no ceiling at all". `0` is included deliberately: an operator who types
 * `0` means "off", not "refuse every byte", and reading it the other way would take a deployment
 * down on a plausible typo.
 */
const UNLIMITED_SPELLINGS = new Set(["0", "off", "none", "unlimited"]);

/**
 * Not a refusal: something the storage screen should say while the write still goes through.
 * `WARN_AT_FRACTION` matches Phase 5 lane B's allowance warning so the two read the same way.
 */
export const STORAGE_WARN_AT_FRACTION = 0.8;

/**
 * Why a write was refused on storage rather than on the key or the plan.
 *
 * One code, not a family: unlike the plan, there is only one thing that can be wrong here. It is a
 * flat 403 in the same shape as `plan_*` and `gateway_blocked`, so `jsonError` and the renderer's
 * parser keep working and the renderer can branch to the storage screen.
 */
export const STORAGE_BLOCK = "storage_quota_exceeded" as const;

export type StorageBlock = typeof STORAGE_BLOCK;

export const STORAGE_WARNINGS = ["storage_low"] as const;

export type StorageWarning = (typeof STORAGE_WARNINGS)[number];

/**
 * The ceiling for one tenant, in bytes, or `null` for "no ceiling".
 *
 * Off server mode: always `null`. In server mode: the parsed environment value, or the default when
 * it is unset. **A value that cannot be parsed falls back to the default rather than to `null`** —
 * a typo in a deployment variable must not silently remove the only thing standing between one
 * tenant and the whole disk.
 */
export function tenantStorageLimitBytes(env: EnvLike = process.env): number | null {
  if (!isServerMode(env)) {
    return null;
  }
  const raw = env[TENANT_STORAGE_BYTES_ENV]?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return DEFAULT_TENANT_STORAGE_BYTES;
  }
  if (UNLIMITED_SPELLINGS.has(raw)) {
    return null;
  }
  // Integer bytes only: `2e9`, `20GB` and `20 GiB` are all rejected rather than guessed at, because
  // guessing wrong picks a ceiling a thousand times too small or too large.
  if (!/^\d+$/.test(raw)) {
    return DEFAULT_TENANT_STORAGE_BYTES;
  }
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TENANT_STORAGE_BYTES;
}

/** What a tenant is using, as the counter row records it. */
export type TenantStorageUse = {
  readonly usedBytes: number;
  readonly objectCount: number;
};

/**
 * What the storage route hands the UI. `limitBytes` and `percent` are `null` together: a desk has
 * a number of bytes and no ceiling, and a percentage of nothing is not zero, it is nothing.
 */
export type TenantStorageReport = {
  readonly usedBytes: number;
  readonly objectCount: number;
  readonly limitBytes: number | null;
  /** 0-100, rounded to one decimal. `null` when there is no limit. May exceed 100 after a raise. */
  readonly percent: number | null;
  /** Never negative. `null` when there is no limit. */
  readonly remainingBytes: number | null;
  readonly warning: StorageWarning | null;
  readonly blocked: boolean;
};

export function storageReport(use: TenantStorageUse, limitBytes: number | null): TenantStorageReport {
  const usedBytes = Math.max(0, Math.trunc(use.usedBytes));
  const objectCount = Math.max(0, Math.trunc(use.objectCount));
  if (limitBytes === null || limitBytes <= 0) {
    return {
      usedBytes,
      objectCount,
      limitBytes: null,
      percent: null,
      remainingBytes: null,
      warning: null,
      blocked: false,
    };
  }
  const fraction = usedBytes / limitBytes;
  return {
    usedBytes,
    objectCount,
    limitBytes,
    percent: Math.round(fraction * 1000) / 10,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    warning: fraction >= STORAGE_WARN_AT_FRACTION ? "storage_low" : null,
    blocked: usedBytes >= limitBytes,
  };
}

/**
 * May this tenant store `incomingBytes` more?
 *
 * The test is on the **resulting** total, not on the current one: a tenant at 19.9 GiB of a 20 GiB
 * ceiling may not upload a 2 GiB video just because they are still under the line today. That is
 * also what makes the check meaningful for the single-large-object case, which is the only way a
 * tenant can overshoot a ceiling by a lot in one step.
 *
 * `limitBytes` of `null` admits everything, and so does an `incomingBytes` of 0 (a delete, a probe,
 * a zero-byte marker): a refusal is never invented for a write that stores nothing.
 */
export function storageAdmission(input: {
  readonly usedBytes: number;
  readonly incomingBytes: number;
  readonly limitBytes: number | null;
}): { readonly ok: true } | { readonly ok: false; readonly reason: StorageBlock } {
  const { limitBytes } = input;
  if (limitBytes === null || limitBytes <= 0) {
    return { ok: true };
  }
  const incoming = Math.max(0, Math.trunc(input.incomingBytes));
  if (incoming === 0) {
    return { ok: true };
  }
  const used = Math.max(0, Math.trunc(input.usedBytes));
  return used + incoming <= limitBytes ? { ok: true } : { ok: false, reason: STORAGE_BLOCK };
}

/** English, specific enough that a support ticket says which rule refused the write. */
export const STORAGE_BLOCK_MESSAGE =
  "This account has used all of its storage. Delete something, or ask for more space, to store new files.";

export { formatBytes } from "./format-bytes";
