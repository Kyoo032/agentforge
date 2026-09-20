/**
 * Phase 5 lane B — what a tenant is entitled to, and the refusal when it is not.
 *
 * The rules themselves are pure and live in `@agentforge/core`'s `entitlement/types.ts`; this is
 * the IO around them: the `tenant_plan` row, the `tenant_seat` rows, the `billing_events`
 * idempotency record, and the one function every gateway call goes through.
 *
 * **The desk is exempt by construction, not by configuration.** Every entry point below returns
 * before it asks for a connection when `isServerMode()` is false. A desktop install therefore
 * never reads `tenant_plan`, never writes a seat, and cannot be blocked by an allowance — which is
 * the same shape Phase 4 gave the state backend, and the reason a desktop database can carry these
 * tables and stay empty. It is also why the migration seeds no row: "no row" IS the desktop's
 * plan, and `defaultPlanRecord` says what that means.
 *
 * **Fail closed in server mode, but only about the right thing.** A hosted request whose plan
 * cannot be read is refused (`plan_unavailable`), because the alternative is serving gateway calls
 * against an entitlement nobody can see. A *missing* row is not that case: it is a tenant the
 * billing webhook has not spoken about yet, and it gets the default plan — active, uncapped —
 * because turning "the provider has not called" into an outage for every tenant at once is the
 * failure mode with no recovery path.
 *
 * **Why the connection is injected rather than imported.** Same reason as `tenant-state-store.ts`:
 * `@agentforge/db`'s entry point OPENS the SQLite file as an import side effect, and this module is
 * reached from `gateway-gate.ts`, which is reached from `settings-store.ts` and from there by half
 * the host's unit tests. `entitlement-db.ts` holds the import and installs itself from `router.ts`,
 * which every request already goes through.
 */
import {
  ApiError,
  defaultPlanRecord,
  isPlanKind,
  isPlanStatus,
  isServerMode,
  resolveEntitlement,
  rolledPlan,
  seatAdmission,
  type EntitlementBlock,
  type PlanKind,
  type PlanStatus,
  type TenantEntitlement,
  type TenantPlanRecord,
} from "@agentforge/core";
import { log } from "./log";

/**
 * The narrow slice of a `better-sqlite3` connection this module needs. Declared rather than
 * imported, so nothing here depends on `@agentforge/db`'s import-time database open.
 */
export type EntitlementSql = {
  prepare(source: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
};

let connection: EntitlementSql | null = null;

/** Called by `entitlement-db.ts`, which `router.ts` pulls in. Idempotent. */
export function registerEntitlementSql(sql: EntitlementSql): void {
  connection = sql;
}

/** Test seam: go back to "nothing registered", which is what a fresh process looks like. */
export function resetEntitlementSqlForTests(): void {
  connection = null;
}

function requireSql(): EntitlementSql {
  if (!connection) {
    throw new ApiError(
      "entitlement_backend_missing",
      "The hosted entitlement backend was never installed, so this tenant's plan cannot be read. " +
        "`packages/host/src/router.ts` imports `entitlement-db.ts`, which installs it.",
      500,
    );
  }
  return connection;
}

type PlanRow = {
  tenant_id: string;
  kind: string;
  status: string;
  allowance_usd_micros: number | null;
  spent_usd_micros: number;
  unpriced_count: number;
  period_start: number;
  period_end: number;
  seat_cap: number | null;
  margin_multiple_micros: number;
  currency: string;
  updated_at: number;
};

function recordFrom(row: PlanRow): TenantPlanRecord {
  return {
    tenantId: row.tenant_id,
    // A value the enum does not know is treated as the safe end of its range rather than trusted:
    // an unreadable `kind` is `personal`, an unreadable `status` is `active`. Neither invents a
    // refusal, and the row is still visible to an operator exactly as the provider wrote it.
    kind: (isPlanKind(row.kind) ? row.kind : "personal") as PlanKind,
    status: (isPlanStatus(row.status) ? row.status : "active") as PlanStatus,
    allowanceUsdMicros: typeof row.allowance_usd_micros === "number" ? row.allowance_usd_micros : null,
    spentUsdMicros: row.spent_usd_micros ?? 0,
    unpricedCount: row.unpriced_count ?? 0,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    seatCap: typeof row.seat_cap === "number" ? row.seat_cap : null,
    marginMultipleMicros: row.margin_multiple_micros,
    currency: row.currency,
    updatedAt: row.updated_at,
  };
}

const UPSERT_PLAN = `INSERT INTO tenant_plan
    (tenant_id, kind, status, allowance_usd_micros, spent_usd_micros, unpriced_count,
     period_start, period_end, seat_cap, margin_multiple_micros, currency, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(tenant_id) DO UPDATE SET
     kind = excluded.kind,
     status = excluded.status,
     allowance_usd_micros = excluded.allowance_usd_micros,
     spent_usd_micros = excluded.spent_usd_micros,
     unpriced_count = excluded.unpriced_count,
     period_start = excluded.period_start,
     period_end = excluded.period_end,
     seat_cap = excluded.seat_cap,
     margin_multiple_micros = excluded.margin_multiple_micros,
     currency = excluded.currency,
     updated_at = excluded.updated_at`;

/** Write the whole row. The only writer of `status` is the webhook; this is the statement it uses. */
export function savePlanRecord(record: TenantPlanRecord): void {
  requireSql()
    .prepare(UPSERT_PLAN)
    .run(
      record.tenantId,
      record.kind,
      record.status,
      record.allowanceUsdMicros,
      record.spentUsdMicros,
      record.unpricedCount,
      record.periodStart,
      record.periodEnd,
      record.seatCap,
      record.marginMultipleMicros,
      record.currency,
      record.updatedAt,
    );
}

/** The stored row, or `null` when this tenant has none. No defaulting and no rolling here. */
export function findPlanRecord(tenantId: string): TenantPlanRecord | null {
  const row = requireSql().prepare("SELECT * FROM tenant_plan WHERE tenant_id = ?").get(tenantId) as
    | PlanRow
    | undefined;
  return row ? recordFrom(row) : null;
}

/**
 * The plan as it stands right now: the stored row rolled onto the current period, or the default
 * plan for a tenant that has none.
 *
 * The roll is persisted when it happens, and only then — a read that does not cross a period
 * boundary writes nothing. A roll that fails to persist is still returned, so the request is
 * answered against the right period even if the write lost a race with another process; the next
 * request rolls it again, because `rolledPlan` is idempotent once the period matches.
 */
export function currentPlanRecord(tenantId: string, nowMs = Date.now()): TenantPlanRecord {
  const stored = findPlanRecord(tenantId);
  if (!stored) {
    return defaultPlanRecord(tenantId, nowMs);
  }
  const rolled = rolledPlan(stored, nowMs);
  if (rolled !== stored) {
    try {
      savePlanRecord(rolled);
    } catch (error) {
      log.warn("entitlement_period_roll_not_persisted", {
        tenantId,
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return rolled;
}

/* ----------------------------------------------------------------------------- seats (D5(b)) */

/** Seats held right now: claimed and not revoked. A revoked row stays, so an admin can see it. */
export function seatsInUse(tenantId: string): number {
  const row = requireSql()
    .prepare("SELECT count(*) AS n FROM tenant_seat WHERE tenant_id = ? AND revoked_at IS NULL")
    .get(tenantId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function holdsSeat(tenantId: string, userId: string): boolean {
  const row = requireSql()
    .prepare("SELECT 1 AS ok FROM tenant_seat WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL")
    .get(tenantId, userId) as { ok: number } | undefined;
  return Boolean(row);
}

/**
 * Take a seat for this person, or say the tenant is full.
 *
 * Called at sign-in, which is where the portal already refuses and already has the reason code —
 * the gateway gate is the wrong place to discover you have no seat, because by then you are signed
 * in and working (decision doc D5).
 *
 * Re-claiming is deliberate and idempotent: a seat that was revoked and is claimed again reuses
 * the same row and clears `revoked_at`, so a person who is let back in does not accumulate rows
 * and the cap count stays exactly "distinct people currently inside".
 */
export function claimSeat(args: {
  tenantId: string;
  userId: string;
  organizationId: string;
  seatCap: number | null;
  nowMs?: number;
}): { readonly ok: true } | { readonly ok: false; readonly reason: "seat_cap_reached" } {
  const now = args.nowMs ?? Date.now();
  const admission = seatAdmission({
    seatCap: args.seatCap,
    seatsInUse: seatsInUse(args.tenantId),
    alreadyHoldsSeat: holdsSeat(args.tenantId, args.userId),
  });
  if (!admission.ok) {
    return admission;
  }
  if (!admission.claim) {
    return { ok: true };
  }
  requireSql()
    .prepare(
      `INSERT INTO tenant_seat (tenant_id, user_id, organization_id, claimed_at, revoked_at, revoked_by)
       VALUES (?, ?, ?, ?, NULL, NULL)
       ON CONFLICT(tenant_id, user_id) DO UPDATE SET
         organization_id = excluded.organization_id,
         claimed_at = excluded.claimed_at,
         revoked_at = NULL,
         revoked_by = NULL`,
    )
    .run(args.tenantId, args.userId, args.organizationId, now);
  return { ok: true };
}

/** An admin gives a seat back. Idempotent: revoking a seat nobody holds changes nothing. */
export function revokeSeat(tenantId: string, userId: string, revokedBy: string, nowMs = Date.now()): void {
  requireSql()
    .prepare(
      "UPDATE tenant_seat SET revoked_at = ?, revoked_by = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL",
    )
    .run(nowMs, revokedBy, tenantId, userId);
}

/* --------------------------------------------------------------- the spend counter (lane A's) */

/**
 * Add one metered call to this period's counter.
 *
 * Called from the ledger write in `tenant-usage.ts`, inside the same request, so the counter and
 * the row move together. The counter is maintained on write rather than re-summed per gateway call
 * because a `SUM` on the request path is a scan of an append-only table at every call (decision
 * doc §3(a)); `tenant_usage_period_idx` exists so the audit that checks the two agree is cheap.
 *
 * An unpriced call adds **zero** to the spend and one to `unpriced_count`. That is the coordinator
 * default for lane A's open question, and it is the only answer that neither blocks a tenant on a
 * row the host could not price nor hides that the row is there.
 *
 * Returns the period the call was counted against, which the ledger stamps on its own row.
 */
export function accrueSpend(args: {
  tenantId: string;
  costUsdMicros: number | null;
  nowMs?: number;
}): number | null {
  if (!isServerMode()) {
    return null;
  }
  const now = args.nowMs ?? Date.now();
  const plan = currentPlanRecord(args.tenantId, now);
  const priced = typeof args.costUsdMicros === "number" && Number.isFinite(args.costUsdMicros);
  const cost = priced ? Math.max(0, Math.round(args.costUsdMicros as number)) : 0;
  // An UPDATE, not a read-modify-write: two concurrent generations must both land. The row may not
  // exist yet (a tenant the webhook has never spoken about), so the upsert writes the default plan
  // with this call already counted rather than dropping the spend on the floor.
  const updated = requireSql()
    .prepare(
      `UPDATE tenant_plan
         SET spent_usd_micros = spent_usd_micros + ?,
             unpriced_count = unpriced_count + ?,
             updated_at = ?
       WHERE tenant_id = ?`,
    )
    .run(cost, priced ? 0 : 1, now, args.tenantId) as { changes?: number };
  if (!updated?.changes) {
    savePlanRecord({
      ...plan,
      spentUsdMicros: cost,
      unpricedCount: priced ? 0 : 1,
      updatedAt: now,
    });
  }
  return plan.periodStart;
}

/* ------------------------------------------------------------------ the webhook's own records */

export type BillingEventRow = {
  readonly eventId: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly occurredAt: number;
  readonly receivedAt: number;
  readonly applied: boolean;
  readonly detail: string | null;
};

export function findBillingEvent(eventId: string): BillingEventRow | null {
  const row = requireSql().prepare("SELECT * FROM billing_events WHERE event_id = ?").get(eventId) as
    | {
        event_id: string;
        tenant_id: string;
        kind: string;
        occurred_at: number;
        received_at: number;
        applied: number;
        detail: string | null;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    applied: Boolean(row.applied),
    detail: row.detail,
  };
}

/**
 * The provider's timestamp on the newest event this host has **applied** for the tenant, or `null`
 * when the webhook has never changed this tenant's plan.
 *
 * This is the only correct input to the ordering rule, and it is deliberately not
 * `tenant_plan.updated_at`: that column moves on every ledger write (`accrueSpend`) and on every
 * persisted period roll, so a tenant that is actively generating would read as newer than every
 * delivery the provider makes and could never be topped up again. See `billingEventDecision`.
 *
 * `applied = 1` is the filter, not merely "seen": a delivery that was refused as `stale` or as
 * `unknown_tenant` changed nothing, so it must not raise the bar for the deliveries after it.
 */
export function lastAppliedEventAt(tenantId: string): number | null {
  const row = requireSql()
    .prepare("SELECT max(occurred_at) AS at FROM billing_events WHERE tenant_id = ? AND applied = 1")
    .get(tenantId) as { at: number | null } | undefined;
  return typeof row?.at === "number" ? row.at : null;
}

/**
 * Record that a delivery was seen. Written for every delivery, applied or not — an event dropped
 * as stale or refused for an unknown tenant is still an event that must not be re-applied later,
 * and `detail` is how an operator finds out why the plan did not change.
 *
 * The primary key is the idempotency, and two concurrent deliveries of the same id must leave
 * exactly one row rather than one of them throwing. The upsert promotes a row **only** from
 * unapplied to applied: a delivery refused as `unknown_tenant` before the tenant first signed in
 * leaves a row that a later retry can still turn into a sale, while an event already applied is
 * never rewritten by a replay of itself. `applied = 1` is therefore terminal, which is what
 * `lastAppliedEventAt` and the `duplicate` test both rely on.
 */
export function recordBillingEvent(row: BillingEventRow): void {
  requireSql()
    .prepare(
      `INSERT INTO billing_events (event_id, tenant_id, kind, occurred_at, received_at, applied, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET
         received_at = excluded.received_at,
         applied = excluded.applied,
         detail = excluded.detail
       WHERE billing_events.applied = 0`,
    )
    .run(row.eventId, row.tenantId, row.kind, row.occurredAt, row.receivedAt, row.applied ? 1 : 0, row.detail);
}

/** Does this host know the tenant an event names? The plan row's foreign key demands it exist. */
export function tenantExists(tenantId: string): boolean {
  const row = requireSql().prepare("SELECT 1 AS ok FROM tenants WHERE id = ?").get(tenantId) as
    | { ok: number }
    | undefined;
  return Boolean(row);
}

/* ------------------------------------------------------------------------ the enforcement path */

/** English, specific enough that a support ticket says which rule closed the gate. */
const BLOCK_MESSAGES: Record<EntitlementBlock, string> = {
  plan_past_due: "This account's payment is overdue. Update the payment method to continue.",
  plan_cancelled: "This account's plan was cancelled. Start a plan to continue.",
  plan_allowance_exhausted: "This account has used its whole allowance for the period. Top up to continue.",
};

/**
 * A call refused on the **plan**, not on the key.
 *
 * Same flat-403 shape as `GatewayBlockedError` so `jsonError` and the renderer's parser keep
 * working, and a different code on purpose: `gateway_blocked` sends the renderer to the
 * paste-your-key onboarding screen, which is a dead end for a hosted tenant who holds no key
 * (decision doc §3(b)). The account screen is where a `plan_*` refusal belongs.
 */
export class PlanBlockedError extends ApiError {
  readonly block: EntitlementBlock;

  constructor(entitlement: TenantEntitlement) {
    const block = entitlement.block ?? "plan_allowance_exhausted";
    super(block, BLOCK_MESSAGES[block], 403);
    this.name = "PlanBlockedError";
    this.block = block;
  }
}

export function isPlanBlockedError(error: unknown): error is PlanBlockedError {
  return error instanceof PlanBlockedError;
}

/**
 * The resolved entitlement for a tenant, or `null` off server mode.
 *
 * `null` is the desk: no plan, no allowance, no database read. Callers treat it as "allowed and
 * nothing to say", which is exactly what the product did before Phase 5.
 */
export function resolveTenantEntitlement(tenantId: string, nowMs = Date.now()): TenantEntitlement | null {
  if (!isServerMode()) {
    return null;
  }
  const plan = currentPlanRecord(tenantId, nowMs);
  return resolveEntitlement(plan, seatsInUse(tenantId), nowMs);
}

/**
 * The host-side enforcement point for the plan, called from `requireGatewayAllowed` so that every
 * gateway call site is covered without one of them changing (decision doc §3(a) — the value is
 * identical at every site within a request, and making the gate async would have touched every
 * `catch` around it).
 *
 * Synchronous, like the gate it sits inside: `better-sqlite3` is synchronous, so the entitlement
 * read introduces no `await` anywhere.
 *
 * Fails closed in server mode. A plan that cannot be read at all is a 503-shaped refusal rather
 * than an allowed call, because the alternative is spending against an entitlement nobody can see.
 */
export function requireEntitlementAllowed(tenantId: string, nowMs = Date.now()): TenantEntitlement | null {
  if (!isServerMode()) {
    return null;
  }
  let entitlement: TenantEntitlement | null;
  try {
    entitlement = resolveTenantEntitlement(tenantId, nowMs);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    log.error("entitlement_read_failed", {
      tenantId,
      detail: error instanceof Error ? error.message : "unknown",
    });
    throw new ApiError("plan_unavailable", "This account's plan could not be read. Try again shortly.", 503);
  }
  if (entitlement?.block) {
    throw new PlanBlockedError(entitlement);
  }
  return entitlement;
}
