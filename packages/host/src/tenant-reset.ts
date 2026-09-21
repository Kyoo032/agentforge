/**
 * Phase 8 — the hosted "Start over": one tenant erases its own content and nobody else's.
 *
 * The desktop has had "Start over" since before any of this: it queues a wipe of the whole data
 * directory and applies it on the next boot (`@agentforge/db`'s `reset.ts`). On the hosted server
 * that directory is every tenant's work, so the route has been refused there since Phase 3 with
 * `reset_disabled` (security spec row T8). Refusing it was right and it was never the end state:
 * a hosted tenant who wants to start clean has had no way to, and "delete your desks one by one"
 * is not an answer when the thing they want gone is their uploads and their saved key.
 *
 * ## What it does, in order, and why that order
 *
 * 1. **The audit row, first.** `started`, written before anything is destroyed. A reset that dies
 *    half way must leave a trace, and after it runs there is nothing left to reconstruct one from
 *    — the threads, runs and media that would have told the story are exactly what went.
 * 2. **The database rows**, in one transaction (`@agentforge/db`'s `tenant-purge.ts`). Everything
 *    that is this tenant's content; never the tenant row, the plan, the seats, the usage ledger or
 *    the billing events — a tenant must not be able to erase what they owe by pressing a button in
 *    their own settings.
 * 3. **The object prefix**, through the Phase 6 store, so it is the bucket on a COS deployment and
 *    the tree on a file one, with the same guard in front of both.
 * 4. **The job trees on local disk**, which are the bytes the object store does not hold: ffmpeg's
 *    scratch, knowledge uploads, dataset files, meeting recordings, legal matter files, channel
 *    state — and the tenant's own settings envelope and gate verdict on a deployment that still
 *    keeps them as files.
 * 5. **The in-process caches**, because a key cached in this process would outlive the row it came
 *    from and the next request would read a secret the tenant has just erased.
 * 6. **Re-provision**, and this is the step that is easy to leave out and fatal to. Deleting the
 *    `organizations` row leaves every live session of this tenant resolving to `org_inactive`
 *    (`resolvePortalTenant` only ever reads — it provisions nothing), so without this the tenant
 *    is not reset, they are bricked until they sign out and back in. `ensurePortalOwner` writes
 *    the org back under the same id the session carries, with a fresh home desk.
 * 7. **The audit row again**, `completed`, with what actually went.
 *
 * ## Idempotent, and safe to retry after a partial failure
 *
 * Every step is a delete by id or an upsert, so running it twice removes what the first pass
 * missed and reports zero for what it already took. That matters because step 3 is not atomic —
 * a bucket can refuse half way through a prefix — and the honest answer to a partial storage
 * failure is "run it again", not a rollback that cannot restore the objects anyway. A `started`
 * row left behind by a killed process is a prompt to do exactly that; it is never a lock.
 *
 * ## Who may call it
 *
 * Owner only, with the typed confirmation, in server mode only. The role comes from the resolved
 * `TenantContext` — the membership row, not anything the client sent — and the desk keeps its own
 * "Start over" untouched, which is why `scope: "all"` stays refused here and `scope: "tenant"` is
 * refused there. Neither mode can reach the other's button.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError, isServerMode, RESET_CONFIRM_WORD, type TenantContext } from "@agentforge/core";
import { db, ensurePortalOwner, purgeTenantRows, sql } from "@agentforge/db";
import { localDataDir } from "@agentforge/db/vault-key";
import { log } from "./log";
import { clearGateState } from "./gateway-gate";
import { clearGatewayKeyEverywhere } from "./settings-store";
import { clearThisKeyCache } from "./account-usage";
import { resetEmbedCircuit } from "./knowledge-embed";
import { resetJobModelCircuit } from "./job-model-fallback";
import { assertPurgeableTenant } from "./tenant-object-keys";
import { isInside, realPathOrNull, tenantDataDir, tenantScopedRoot } from "./tenant-paths";
import { forgetTenantJobBytes, tenantObjectStore } from "./tenant-storage";

/**
 * The word the owner types — `RESET_CONFIRM_WORD`, the same literal the desk's "Start over" uses.
 *
 * One word in one place rather than a second one here. The confirmation's job is to make somebody
 * stop and read the dialog they are in, and the two dialogs say plainly different things; a second
 * literal would only add a copy the renderer has to keep in step, which is how the box and the
 * check drift apart. The scope is what distinguishes the two acts on the wire, and each mode
 * refuses the other's scope outright.
 */
export const TENANT_RESET_CONFIRM_WORD = RESET_CONFIRM_WORD;

export const TENANT_RESET_DISABLED_CODE = "tenant_reset_disabled";
export const TENANT_RESET_DISABLED_MESSAGE =
  "Erasing an account is only available on the hosted service. On this machine, use Start over.";

export const TENANT_RESET_FORBIDDEN_CODE = "tenant_reset_forbidden";
export const TENANT_RESET_FORBIDDEN_MESSAGE =
  "Only an owner of this account can erase it. Ask an owner to do it.";

export type TenantResetOutcome = {
  readonly ok: true;
  readonly auditId: string;
  readonly rowsDeleted: number;
  readonly objectsDeleted: number;
  readonly bytesFreed: number;
  /** The home desk the tenant lands on afterwards, so the renderer can send them straight to it. */
  readonly workspaceId: string;
};

/**
 * Every directory outside the object store that holds this tenant's bytes.
 *
 * Lane D's layout, read back: a hosted tenant's files live under `tenants/<id>/` inside each shared
 * root. `tenantDataDir` covers the ffmpeg scratch, the knowledge uploads, the object cache and —
 * on a deployment that has not adopted the `tenant_state` rows — the settings envelope and the
 * gate verdict. The other four are the shared roots that are not the media root, which the object
 * store owns.
 *
 * Declared here rather than derived from `tenantJobRoots` because the two answer different
 * questions: that one is "what does this tenant get charged for" (and deliberately excludes the
 * host's own object cache), this one is "what has to go". A byte the host cached on the tenant's
 * behalf is not the tenant's to be charged for and IS theirs to have deleted.
 */
export function tenantPurgeRoots(tenantId: string): string[] {
  const dataDir = localDataDir();
  return [
    tenantDataDir(tenantId),
    tenantScopedRoot(path.join(dataDir, "datasets"), tenantId),
    tenantScopedRoot(path.join(dataDir, "meetings"), tenantId),
    tenantScopedRoot(path.join(dataDir, "legal"), tenantId),
    tenantScopedRoot(path.join(dataDir, "channels"), tenantId),
  ];
}

/**
 * Remove one directory, having proved twice that it really is under the data directory.
 *
 * The spelling is checked by `isInside` and the inode by `realPathOrNull`, and a path that is
 * plainly the data directory itself is refused outright. This is the same two-step Phase 7 gave
 * `managedComponentsRoot` and `@agentforge/db`'s `removeEntry` gives a reset entry, and it exists
 * for the same reason: a symlink planted at `tenants/<id>/` passes any lexical test while pointing
 * at `/`, and this function's whole job is a recursive delete.
 */
async function removeTenantRoot(root: string): Promise<void> {
  const dataDir = path.resolve(localDataDir());
  const resolved = path.resolve(root);
  if (!isInside(dataDir, resolved)) {
    throw new ApiError("tenant_reset_refused", "A per-tenant path resolved outside the data directory.", 500);
  }
  const real = realPathOrNull(resolved);
  if (real === null) {
    // Nothing on disk at that path. Nothing to delete, and nothing to be wrong about.
    return;
  }
  if (!isInside(dataDir, real) || real === dataDir) {
    throw new ApiError("tenant_reset_refused", "A per-tenant path links outside the data directory.", 500);
  }
  await rm(real, { recursive: true, force: true });
}

type AuditRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly organizationId: string;
};

function openAudit(tenant: TenantContext): AuditRow {
  const row: AuditRow = {
    id: randomUUID(),
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    organizationId: tenant.organizationId,
  };
  sql
    .prepare(
      `INSERT INTO tenant_reset_audit
         (id, tenant_id, user_id, organization_id, outcome, detail, rows_deleted, objects_deleted, bytes_freed, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'started', NULL, 0, 0, 0, ?, NULL)`,
    )
    .run(row.id, row.tenantId, row.userId, row.organizationId, Date.now());
  return row;
}

function closeAudit(
  row: AuditRow,
  outcome: "completed" | "failed",
  totals: { rowsDeleted: number; objectsDeleted: number; bytesFreed: number },
  detail: string | null,
): void {
  sql
    .prepare(
      `UPDATE tenant_reset_audit
          SET outcome = ?, detail = ?, rows_deleted = ?, objects_deleted = ?, bytes_freed = ?, finished_at = ?
        WHERE id = ?`,
    )
    .run(outcome, detail, totals.rowsDeleted, totals.objectsDeleted, totals.bytesFreed, Date.now(), row.id);
}

/**
 * A fixed phrase for the audit row, never the thrown message.
 *
 * A storage error carries a bucket name and a request id; a SQLite error carries an absolute path.
 * The operator reads the real thing in the log, where it is already written with its stack. This
 * column is read back into an API response, so it holds a category and nothing else.
 */
function auditDetail(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code;
  }
  return "unexpected_error";
}

/**
 * Erase this tenant's content. See the module comment for the order and the reasoning.
 *
 * `confirm` is what the owner actually typed, compared here rather than by the caller: a route that
 * trusted its own constant would let a mismatched confirmation box through on the renderer's say-so
 * instead of the owner's.
 */
export async function resetTenant(tenant: TenantContext, confirm: string | undefined): Promise<TenantResetOutcome> {
  if (!isServerMode()) {
    throw new ApiError(TENANT_RESET_DISABLED_CODE, TENANT_RESET_DISABLED_MESSAGE, 403);
  }
  // Owner, not merely an administrator: this is the most destructive thing a session can do and it
  // is not reversible. `canAdminister` would also admit `admin`, which is the right bar for
  // changing settings and the wrong one for erasing everybody in the org's work.
  if (tenant.role !== "owner") {
    throw new ApiError(TENANT_RESET_FORBIDDEN_CODE, TENANT_RESET_FORBIDDEN_MESSAGE, 403);
  }
  if (confirm !== TENANT_RESET_CONFIRM_WORD) {
    throw new ApiError(
      "invalid_request",
      `confirm must be "${TENANT_RESET_CONFIRM_WORD}" to erase this account`,
      400,
    );
  }
  // The local tenant's prefix is the whole store (lane D), so a mis-resolved id must hit a wall
  // here — before the audit row, before the transaction — rather than an `rm -rf`.
  assertPurgeableTenant(tenant.tenantId);

  const audit = openAudit(tenant);
  const totals = { rowsDeleted: 0, objectsDeleted: 0, bytesFreed: 0 };
  try {
    // 2. The rows, in one transaction. Nothing on disk has been touched yet, so a failure here
    //    leaves the tenant exactly as they were.
    const purged = purgeTenantRows(sql, tenant.tenantId);
    totals.rowsDeleted = purged.rowsDeleted;

    // 3. The objects, through the store the deployment is configured for.
    const removed = await tenantObjectStore().removePrefix(tenant.tenantId);
    totals.objectsDeleted = removed.objectCount;
    totals.bytesFreed = removed.usedBytes;

    // 4. The bytes the store does not hold.
    for (const root of tenantPurgeRoots(tenant.tenantId)) {
      await removeTenantRoot(root);
    }
    forgetTenantJobBytes(tenant.tenantId);

    // 5. Anything this process is still holding about them. `clearGatewayKeyEverywhere` and
    //    `clearGateState` are the same two calls "forget my key" makes, so a tenant who resets is
    //    left in exactly the state a tenant who signed out of the gateway is.
    clearGatewayKeyEverywhere(tenant);
    clearGateState(tenant);
    clearThisKeyCache();
    resetEmbedCircuit();
    resetJobModelCircuit();

    // 6. Put the account back. Without this the tenant's own live session resolves to
    //    `org_inactive` on its very next request and there is no way back in from the UI.
    const provisioned = await ensurePortalOwner(db, {
      tenantId: tenant.tenantId,
      orgId: tenant.organizationId,
      userId: tenant.userId,
    });

    closeAudit(audit, "completed", totals, null);
    log.warn("tenant_reset_completed", {
      tenantId: tenant.tenantId,
      auditId: audit.id,
      rowsDeleted: totals.rowsDeleted,
      objectsDeleted: totals.objectsDeleted,
      bytesFreed: totals.bytesFreed,
    });
    return {
      ok: true,
      auditId: audit.id,
      rowsDeleted: totals.rowsDeleted,
      objectsDeleted: totals.objectsDeleted,
      bytesFreed: totals.bytesFreed,
      workspaceId: provisioned.workspaceId,
    };
  } catch (error) {
    closeAudit(audit, "failed", totals, auditDetail(error));
    log.error("tenant_reset_failed", { tenantId: tenant.tenantId, auditId: audit.id, error });
    throw error;
  }
}
