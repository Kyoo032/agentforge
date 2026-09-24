/**
 * Phase 5 lane B — the allowance, the seats and the entitlement store, against a real database.
 *
 * The plan's own "Tests" list for Phase 5 asks for six things, and five of them are here (the
 * sixth, a bad webhook signature changing nothing, is in `handlers/billing.test.ts` where the
 * route is): a tenant at 99% passes and at 101% is refused, a `past_due` tenant is refused, a
 * tenant at its seat cap refuses a new member and admits an existing one, and both recover when
 * the webhook flips the row.
 *
 * Plus the one this lane has to prove on its own: **the desk is exempt by construction.** Every
 * case in that block runs with no connection registered at all, so if any desk path reached for
 * the database it would throw `entitlement_backend_missing` rather than quietly passing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, applyBillingEvent, calendarMonthPeriod, type TenantContext } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";

const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-entitlement-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_RUNTIME;
delete process.env.OPENAI_API_KEY;

const store = await import("./entitlement-store");
const usage = await import("./tenant-usage");
const gate = await import("./gateway-gate");
const settingsStore = await import("./settings-store");
const tenantState = await import("./tenant-state-store");

const TENANT = "tenant-alpha";
const OTHER = "tenant-beta";
const MARCH = Date.UTC(2026, 2, 14, 9, 30);
const APRIL = Date.UTC(2026, 3, 2, 0, 0);

const tenant: TenantContext = {
  tenantId: TENANT,
  organizationId: "org-a",
  workspaceId: "desk-a",
  userId: "user-1",
  role: "owner",
};

let db: Database.Database;

function seedTenant(id: string): void {
  db.prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    id,
    id,
    "active",
    MARCH,
  );
}

/**
 * A plan row as the billing webhook would have written it, in the period the clock is actually in.
 *
 * The period defaults to **now**, not to `MARCH`: a record stamped with a month the clock has left
 * is rolled on the first read, its spend forgiven, and a case about an exhausted allowance would
 * then pass for the wrong reason. The cases that are about the roll say so by passing a period.
 */
function givePlan(id: string, over: Partial<Parameters<typeof store.savePlanRecord>[0]> = {}): void {
  seedTenant(id);
  store.savePlanRecord({
    tenantId: id,
    kind: "personal",
    status: "active",
    allowanceUsdMicros: null,
    spentUsdMicros: 0,
    unpricedCount: 0,
    ...calendarMonthPeriod(Date.now()),
    seatCap: null,
    marginMultipleMicros: 1_000_000,
    currency: "USD",
    updatedAt: MARCH,
    ...over,
  });
}

beforeEach(() => {
  db = new Database(":memory:");
  ensureSchema(db);
  store.registerEntitlementSql(db);
  // Phase 4's backend, on the same connection: in server mode a tenant's settings are rows, and
  // `requireGatewayAllowedFor` reads them before it reaches the gate.
  tenantState.registerTenantStateSql(db);
  process.env.AGENTFORGE_SERVER = "1";
  // Server mode makes the wrap key mandatory (Phase 1), and these cases save a tenant's key to
  // drive the gate. A generated 32 bytes, fixed here: `getLocalVaultKey` refuses a typed pattern,
  // and this one only ever seals a row in a database that lives for one test.
  process.env.AGENTFORGE_SECRETS_KEY = "9a24a841b75e4ba53a314c3b20e7eceb3cd52ad46c5637f9d23d17101f540e8f";
  seedTenant(TENANT);
  seedTenant(OTHER);
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
  delete process.env.AGENTFORGE_SECRETS_KEY;
  store.resetEntitlementSqlForTests();
  tenantState.resetTenantStateSqlForTests();
  usage.setUsageStoreForTests(null);
  settingsStore.resetSettingsCacheForTests();
  db.close();
});

afterAll(async () => {
  // `./tenant-usage` imports @agentforge/db, which opened the kernel SQLite inside dataDir. Windows
  // will not delete a file something still holds, so that handle is closed before the dir goes.
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("a tenant with no plan row", () => {
  it("resolves to an active, uncapped, unmetered plan", () => {
    const entitlement = store.resolveTenantEntitlement(TENANT, MARCH);
    expect(entitlement).toMatchObject({ status: "active", allowanceUsdMicros: null, block: null, seatCap: null });
  });

  it("is not written to the table by being read", () => {
    store.resolveTenantEntitlement(TENANT, MARCH);
    // The default is a value, not a row. Writing one on read would make every read a write and
    // would give the webhook a row to race with before it has said anything.
    expect(db.prepare("SELECT count(*) AS n FROM tenant_plan").get()).toEqual({ n: 0 });
  });

  it("passes the gateway gate's plan check", () => {
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).not.toThrow();
  });
});

describe("the allowance", () => {
  it("passes at 99% and refuses at 101%", () => {
    givePlan(TENANT, { allowanceUsdMicros: 100_000, spentUsdMicros: 99_000 });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).not.toThrow();

    givePlan(TENANT, { allowanceUsdMicros: 100_000, spentUsdMicros: 101_000 });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).toThrow(
      expect.objectContaining({ code: "plan_allowance_exhausted" }),
    );
  });

  it("refuses with a plan code and a 403, never with gateway_blocked", () => {
    // The non-negotiable from the decision doc: `gateway_blocked` routes the renderer to the
    // paste-your-key onboarding screen, and a hosted tenant over its allowance holds no key.
    givePlan(TENANT, { allowanceUsdMicros: 10, spentUsdMicros: 10 });
    try {
      store.requireEntitlementAllowed(TENANT, MARCH);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(store.isPlanBlockedError(error)).toBe(true);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).code).not.toBe("gateway_blocked");
      expect((error as ApiError).message).toMatch(/allowance/i);
    }
  });

  it("refuses a past_due tenant whatever it has spent", () => {
    givePlan(TENANT, { status: "past_due", allowanceUsdMicros: 1_000_000, spentUsdMicros: 0 });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).toThrow(
      expect.objectContaining({ code: "plan_past_due" }),
    );
  });

  it("refuses a cancelled tenant", () => {
    givePlan(TENANT, { status: "cancelled" });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).toThrow(
      expect.objectContaining({ code: "plan_cancelled" }),
    );
  });

  it("blocks one tenant without touching another", () => {
    givePlan(TENANT, { allowanceUsdMicros: 10, spentUsdMicros: 10 });
    givePlan(OTHER, { allowanceUsdMicros: 10, spentUsdMicros: 0 });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).toThrow();
    expect(() => store.requireEntitlementAllowed(OTHER, MARCH)).not.toThrow();
  });
});

describe("recovering from a block", () => {
  it("recovers when a webhook raises the allowance", () => {
    givePlan(TENANT, { allowanceUsdMicros: 100, spentUsdMicros: 100 });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).toThrow();

    const raised = applyBillingEvent(
      store.currentPlanRecord(TENANT, MARCH),
      { eventId: "evt-1", tenantId: TENANT, kind: "allowance.topup", occurredAt: MARCH, topUpUsdMicros: 5_000 },
      MARCH,
    );
    store.savePlanRecord(raised);

    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).not.toThrow();
  });

  it("recovers when a webhook flips the status back to active", () => {
    givePlan(TENANT, { status: "past_due" });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).toThrow();

    store.savePlanRecord(
      applyBillingEvent(
        store.currentPlanRecord(TENANT, MARCH),
        { eventId: "evt-2", tenantId: TENANT, kind: "entitlement.set", occurredAt: MARCH, entitlement: { status: "active" } },
        MARCH,
      ),
    );

    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).not.toThrow();
  });

  it("recovers when the period rolls, and persists the roll", () => {
    // The one case that needs a period the clock has left, so it is stamped explicitly.
    givePlan(TENANT, { allowanceUsdMicros: 100, spentUsdMicros: 100, ...calendarMonthPeriod(MARCH) });
    expect(() => store.requireEntitlementAllowed(TENANT, MARCH)).toThrow();

    expect(() => store.requireEntitlementAllowed(TENANT, APRIL)).not.toThrow();

    // Persisted, not only computed: the next process to read this row must see the new period
    // rather than roll it again from a spend that has already been forgiven.
    const row = db.prepare("SELECT spent_usd_micros AS spent, period_start AS start FROM tenant_plan").get() as {
      spent: number;
      start: number;
    };
    expect(row).toEqual({ spent: 0, start: Date.UTC(2026, 3, 1) });
  });
});

describe("spend accrues with the ledger row", () => {
  beforeEach(() => {
    usage.setUsageStoreForTests(usage.createUsageStore(db));
    givePlan(TENANT, { allowanceUsdMicros: 10_000 });
  });

  it("moves the counter and stamps the period on the row", () => {
    const row = usage.recordUsage(tenant, {
      mode: "chat",
      model: "gpt-5.6-sol",
      unit: "tokens",
      quantity: 10,
      inputTokens: 6,
      outputTokens: 4,
      costUsdMicros: 2_500,
    });

    expect(row?.billingPeriodStart).toBe(calendarMonthPeriod(Date.now()).periodStart);
    expect(store.currentPlanRecord(TENANT).spentUsdMicros).toBe(2_500);
  });

  it("counts an unpriced call as zero spend and one warning", () => {
    // Lane A left this open on purpose. Blocking on a row the host could not price would refuse a
    // tenant for the catalog's failure; ignoring it would undercount silently.
    usage.recordUsage(tenant, {
      mode: "music",
      model: "suno_music",
      unit: "jobs",
      quantity: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: null,
      unpricedReason: "catalog_unavailable",
    });

    const plan = store.currentPlanRecord(TENANT);
    expect(plan.spentUsdMicros).toBe(0);
    expect(plan.unpricedCount).toBe(1);
    expect(store.resolveTenantEntitlement(TENANT)?.warnings).toContain("unpriced_usage");
    expect(store.resolveTenantEntitlement(TENANT)?.block).toBeNull();
  });

  it("agrees with the ledger it stamped, which is the whole point of the column", () => {
    for (const cost of [1_000, 2_000, 3_000]) {
      usage.recordUsage(tenant, {
        mode: "chat",
        model: "m",
        unit: "tokens",
        quantity: 1,
        inputTokens: 1,
        outputTokens: 0,
        costUsdMicros: cost,
      });
    }
    const plan = store.currentPlanRecord(TENANT);
    const audited = db
      .prepare(
        "SELECT COALESCE(SUM(cost_usd_micros), 0) AS total FROM tenant_usage WHERE tenant_id = ? AND billing_period_start = ?",
      )
      .get(TENANT, plan.periodStart) as { total: number };
    expect(audited.total).toBe(plan.spentUsdMicros);
    expect(plan.spentUsdMicros).toBe(6_000);
  });

  it("counts spend for a tenant the webhook has never spoken about", () => {
    // No plan row: the upsert writes the default plan with this call already counted, rather than
    // dropping the spend because nobody had sold this tenant anything yet.
    db.prepare("DELETE FROM tenant_plan WHERE tenant_id = ?").run(TENANT);
    usage.recordUsage(tenant, {
      mode: "chat",
      model: "m",
      unit: "tokens",
      quantity: 1,
      inputTokens: 1,
      outputTokens: 0,
      costUsdMicros: 4_200,
    });
    expect(store.currentPlanRecord(TENANT).spentUsdMicros).toBe(4_200);
  });

  it("takes a tenant past its allowance and blocks the next call", () => {
    givePlan(TENANT, { allowanceUsdMicros: 3_000 });
    usage.recordUsage(tenant, {
      mode: "images",
      model: "img",
      unit: "images",
      quantity: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 3_500,
    });
    // Enforced before the call and measured after it, so this one overshot — which is the plan's
    // own stated risk. What must be true is that the NEXT call is refused.
    expect(() => store.requireEntitlementAllowed(TENANT)).toThrow(
      expect.objectContaining({ code: "plan_allowance_exhausted" }),
    );
  });
});

describe("seats", () => {
  it("admits members up to the cap and refuses the one past it", () => {
    givePlan(TENANT, { kind: "enterprise", seatCap: 2 });
    expect(store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 2 }).ok).toBe(true);
    expect(store.claimSeat({ tenantId: TENANT, userId: "u2", organizationId: "org", seatCap: 2 }).ok).toBe(true);
    expect(store.claimSeat({ tenantId: TENANT, userId: "u3", organizationId: "org", seatCap: 2 })).toEqual({
      ok: false,
      reason: "seat_cap_reached",
    });
    expect(store.seatsInUse(TENANT)).toBe(2);
  });

  it("keeps admitting a member who already holds a seat after the cap is reached", () => {
    givePlan(TENANT, { seatCap: 1 });
    store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 1 });
    // The plan's Tests list, and the reason D5(b) was chosen: an existing member signing in again
    // is not a new seat, so a full tenant does not lock out the people already inside it.
    expect(store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 1 }).ok).toBe(true);
    expect(store.seatsInUse(TENANT)).toBe(1);
  });

  it("frees a seat when an admin revokes it, and not before", () => {
    givePlan(TENANT, { seatCap: 1 });
    store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 1 });
    expect(store.claimSeat({ tenantId: TENANT, userId: "u2", organizationId: "org", seatCap: 1 }).ok).toBe(false);

    store.revokeSeat(TENANT, "u1", "admin-1", MARCH);

    expect(store.seatsInUse(TENANT)).toBe(0);
    expect(store.claimSeat({ tenantId: TENANT, userId: "u2", organizationId: "org", seatCap: 1 }).ok).toBe(true);
  });

  it("keeps the revoked row, so an admin screen can say who was revoked and when", () => {
    givePlan(TENANT, { seatCap: 2 });
    store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 2 });
    store.revokeSeat(TENANT, "u1", "admin-1", MARCH);
    expect(db.prepare("SELECT revoked_at AS at, revoked_by AS by FROM tenant_seat WHERE user_id = 'u1'").get()).toEqual({
      at: MARCH,
      by: "admin-1",
    });
  });

  it("re-seats a revoked person on the same row rather than a second one", () => {
    givePlan(TENANT, { seatCap: 2 });
    store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 2 });
    store.revokeSeat(TENANT, "u1", "admin-1", MARCH);
    store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 2 });
    expect(db.prepare("SELECT count(*) AS n FROM tenant_seat").get()).toEqual({ n: 1 });
    expect(store.seatsInUse(TENANT)).toBe(1);
  });

  it("recovers when the cap is raised", () => {
    givePlan(TENANT, { seatCap: 1 });
    store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 1 });
    expect(store.claimSeat({ tenantId: TENANT, userId: "u2", organizationId: "org", seatCap: 1 }).ok).toBe(false);

    store.savePlanRecord(
      applyBillingEvent(
        store.currentPlanRecord(TENANT, MARCH),
        { eventId: "e", tenantId: TENANT, kind: "entitlement.set", occurredAt: MARCH, entitlement: { seatCap: 5 } },
        MARCH,
      ),
    );

    const cap = store.currentPlanRecord(TENANT, MARCH).seatCap;
    expect(store.claimSeat({ tenantId: TENANT, userId: "u2", organizationId: "org", seatCap: cap }).ok).toBe(true);
  });

  it("counts one tenant's seats and not another's", () => {
    givePlan(TENANT, { seatCap: 1 });
    givePlan(OTHER, { seatCap: 1 });
    store.claimSeat({ tenantId: OTHER, userId: "u1", organizationId: "org", seatCap: 1 });
    expect(store.seatsInUse(TENANT)).toBe(0);
    expect(store.claimSeat({ tenantId: TENANT, userId: "u1", organizationId: "org", seatCap: 1 }).ok).toBe(true);
  });
});

describe("the gateway gate carries the plan check", () => {
  /**
   * These three tenants all hold no gateway key, so the gate's own answer is `needs_key` — which
   * is exactly what makes the ordering visible: whichever refusal comes out names which check ran
   * first. The whole reason the plan check lives inside `requireGatewayAllowed` is that every
   * call site gained it without one of them changing, and none of them gained an `await`.
   */
  it("refuses a blocked tenant with the plan code, not with the key's", () => {
    givePlan(TENANT, { allowanceUsdMicros: 10, spentUsdMicros: 99 });
    try {
      gate.requireGatewayAllowedFor(tenant);
      throw new Error("expected a refusal");
    } catch (error) {
      // `gateway_blocked` would send this tenant to the paste-your-key screen, which is where a
      // hosted tenant with no key cannot do anything at all.
      expect((error as ApiError).code).toBe("plan_allowance_exhausted");
      expect(gate.isGatewayBlockedError(error)).toBe(false);
    }
  });

  it("lets an allowed tenant reach the key check unchanged", () => {
    givePlan(TENANT, { allowanceUsdMicros: 10_000 });
    try {
      gate.requireGatewayAllowedFor(tenant);
      throw new Error("expected the gate's own refusal");
    } catch (error) {
      // The plan said nothing, so the gate answered for itself, exactly as it did before lane B.
      expect(gate.isGatewayBlockedError(error)).toBe(true);
      expect((error as ApiError).code).toBe("gateway_blocked");
    }
  });

  it("refuses rather than allowing when the backend was never installed", () => {
    // Fail closed: a hosted process whose entitlement store is missing must not serve gateway
    // calls against a plan nobody can read. Phase 4's settings backend stays installed, so what
    // this reaches is the entitlement refusal and not that one.
    store.resetEntitlementSqlForTests();
    expect(() => gate.requireGatewayAllowedFor(tenant)).toThrow(
      expect.objectContaining({ code: "entitlement_backend_missing" }),
    );
  });
});

describe("the desk is exempt by construction", () => {
  beforeEach(() => {
    delete process.env.AGENTFORGE_SERVER;
    // No entitlement connection at all. Anything below that reached for the database would throw
    // `entitlement_backend_missing`, so these cases cannot pass by accident. Phase 4's backend is
    // reset too: off server mode a desk reads its settings from files, exactly as it always did.
    store.resetEntitlementSqlForTests();
    tenantState.resetTenantStateSqlForTests();
  });

  it("resolves no entitlement and opens no database", () => {
    expect(store.resolveTenantEntitlement("local-tenant")).toBeNull();
    expect(store.requireEntitlementAllowed("local-tenant")).toBeNull();
  });

  it("records spend without a plan and stamps no period", () => {
    usage.setUsageStoreForTests(usage.createUsageStore(db));
    const row = usage.recordUsage(
      { ...tenant, tenantId: "local-tenant" },
      { mode: "chat", model: "m", unit: "tokens", quantity: 1, inputTokens: 1, outputTokens: 0, costUsdMicros: 9 },
    );
    expect(row?.billingPeriodStart).toBeNull();
    expect(store.accrueSpend({ tenantId: "local-tenant", costUsdMicros: 9 })).toBeNull();
  });

  it("lets the gateway gate through with no plan anywhere", () => {
    // The stub runtime is the desk's open gate (Cloud, Playwright, the unit suites), and it stays
    // open: nothing lane B added may close a desk, and reaching for a plan here would throw.
    expect(
      gate.requireGatewayAllowedFor({ tenantId: "local-tenant", workspaceId: "desk-a" }, { envRuntime: "stub" })
        .allowed,
    ).toBe(true);
  });
});
