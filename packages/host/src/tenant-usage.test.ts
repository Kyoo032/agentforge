import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext, UsageEvent } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import { createUsageStore, USAGE_LIST_LIMIT, type UsageStore } from "./tenant-usage";

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-a",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "owner",
};

/** A second tenant, which every one of these tests must stay out of. */
const other: TenantContext = {
  tenantId: "tenant-b",
  organizationId: "org-b",
  workspaceId: "ws-9",
  userId: "user-9",
  role: "owner",
};

function tokens(over: Partial<UsageEvent> = {}): UsageEvent {
  return {
    mode: "chat",
    model: "gpt-5.6-sol",
    unit: "tokens",
    quantity: 140,
    inputTokens: 100,
    outputTokens: 40,
    costUsdMicros: 2_500,
    ...over,
  };
}

describe("tenant usage ledger", () => {
  let db: Database.Database;
  let store: UsageStore;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    // The second tenant has to exist: `tenant_usage.tenant_id` is a real foreign key.
    db.prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)").run(
      other.tenantId,
      "tenant-b",
      "Tenant B",
      "active",
      Date.now(),
    );
    store = createUsageStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("ensureSchema creates tenant_usage with the full ledger column set", () => {
    const columns = (db.prepare("PRAGMA table_info(tenant_usage)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(columns.sort()).toEqual(
      [
        "at",
        // Phase 5 lane B (drizzle/0017_tenant_plan.sql): the billing period this call counted
        // against. Null on a desk and on every row lane A wrote, because nothing was counting.
        "billing_period_start",
        "cost_usd_micros",
        "id",
        "input_tokens",
        "mode",
        "model",
        "organization_id",
        "output_tokens",
        "quantity",
        "run_id",
        "tenant_id",
        "unit",
        "unpriced_reason",
        "user_id",
        "workspace_id",
      ].sort(),
    );
  });

  it("writes one row carrying the tenant, organization, user, mode, unit and cost", () => {
    const row = store.record(tenant, tokens({ mode: "documents", runId: "document-1" }));
    expect(row).not.toBeNull();

    const rows = store.list(tenant);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: "local-tenant",
      organizationId: "org-a",
      workspaceId: "ws-1",
      userId: "user-1",
      mode: "documents",
      model: "gpt-5.6-sol",
      unit: "tokens",
      quantity: 140,
      inputTokens: 100,
      outputTokens: 40,
      costUsdMicros: 2_500,
      runId: "document-1",
    });
    expect(rows[0]?.unpricedReason).toBeUndefined();
  });

  it("keeps an unpriced row, with its unit, its quantity and the reason", () => {
    store.record(
      tenant,
      tokens({ mode: "research", model: "mystery-model", costUsdMicros: null, unpricedReason: "model_not_in_catalog" }),
    );

    const [row] = store.list(tenant);
    // The whole point of lane A: the call is visible even though nobody can price it.
    expect(row).toMatchObject({
      mode: "research",
      unit: "tokens",
      quantity: 140,
      costUsdMicros: null,
      unpricedReason: "model_not_in_catalog",
    });
  });

  it("never stores a row with neither a cost nor a reason", () => {
    store.record(tenant, tokens({ costUsdMicros: null }));
    const [row] = store.list(tenant);
    expect(row?.costUsdMicros).toBeNull();
    expect(row?.unpricedReason).toBe("catalog_unavailable");
  });

  it("meters images in images and videos in seconds", () => {
    store.record(tenant, {
      mode: "images",
      model: "seedream-4.5",
      unit: "images",
      quantity: 1,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 40_000,
    });
    store.record(tenant, {
      mode: "videos",
      model: "veo-3.1-lite",
      unit: "seconds",
      quantity: 8,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 400_000,
    });

    expect(store.list(tenant, { modes: ["images"] })[0]).toMatchObject({ unit: "images", quantity: 1 });
    expect(store.list(tenant, { modes: ["videos"] })[0]).toMatchObject({ unit: "seconds", quantity: 8 });
  });

  it("keeps one tenant's ledger out of another's, on every read", () => {
    store.record(tenant, tokens());
    store.record(other, tokens({ costUsdMicros: 9_999_999 }));

    expect(store.list(tenant)).toHaveLength(1);
    expect(store.list(other)).toHaveLength(1);
    expect(store.totals(tenant).costUsdMicros).toBe(2_500);
    expect(store.totals(other).costUsdMicros).toBe(9_999_999);
  });

  it("refuses a row it cannot attribute rather than writing an anonymous one", () => {
    expect(store.record({ ...tenant, tenantId: "  " }, tokens())).toBeNull();
    expect(store.record({ ...tenant, organizationId: "" }, tokens())).toBeNull();
    expect(store.record(tenant, tokens({ model: "   " }))).toBeNull();
    expect(store.record(tenant, tokens({ unit: "furlongs" as never }))).toBeNull();
    expect(store.record(tenant, tokens({ mode: "telepathy" as never }))).toBeNull();
    expect(store.list(tenant)).toHaveLength(0);
  });

  it("totals the priced rows and counts the unpriced ones by reason", () => {
    store.record(tenant, tokens({ costUsdMicros: 1_000 }));
    store.record(tenant, tokens({ costUsdMicros: 2_000 }));
    store.record(tenant, tokens({ costUsdMicros: null, unpricedReason: "tiered_billing" }));
    store.record(tenant, tokens({ costUsdMicros: null, unpricedReason: "tiered_billing" }));
    store.record(tenant, tokens({ costUsdMicros: null, unpricedReason: "catalog_unavailable" }));

    expect(store.totals(tenant)).toEqual({
      costUsdMicros: 3_000,
      pricedCount: 2,
      unpricedCount: 3,
      unpricedByReason: { tiered_billing: 2, catalog_unavailable: 1 },
    });
  });

  it("filters by mode and by period", () => {
    store.record(tenant, tokens({ mode: "chat" }));
    store.record(tenant, tokens({ mode: "edit" }));
    store.record(tenant, tokens({ mode: "images", unit: "images", quantity: 1 }));

    expect(store.list(tenant, { modes: ["edit"] })).toHaveLength(1);
    expect(store.list(tenant, { excludeModes: ["chat"] })).toHaveLength(2);
    expect(store.totals(tenant, { excludeModes: ["chat"] }).pricedCount).toBe(2);

    const future = Date.now() + 60_000;
    expect(store.list(tenant, { from: future })).toHaveLength(0);
    expect(store.totals(tenant, { from: future })).toMatchObject({ costUsdMicros: 0, pricedCount: 0 });
  });

  it("caps one read so a long-lived ledger cannot be paged into memory whole", () => {
    expect(store.list(tenant, { limit: USAGE_LIST_LIMIT * 10 })).toEqual([]);
    expect(store.list(tenant, { limit: 0 })).toEqual([]);
  });

  it("deletes a tenant's ledger with the tenant", () => {
    store.record(other, tokens());
    expect(store.list(other)).toHaveLength(1);
    db.prepare("DELETE FROM tenants WHERE id = ?").run(other.tenantId);
    expect(store.list(other)).toHaveLength(0);
  });

  it("keeps the ledger when an organization inside a live tenant goes away", () => {
    // Deliberately not a foreign key: deleting one org must not erase spend still to be billed.
    store.record(tenant, tokens());
    db.prepare("DELETE FROM organizations WHERE id = ?").run(tenant.organizationId);
    expect(store.list(tenant)).toHaveLength(1);
  });
});
