/**
 * Phase 5 lane B — the billing routes, driven through `dispatch` on a real database.
 *
 * Through `dispatch` rather than by calling the handlers, because three of the things that have to
 * be true are not in the handler at all: the webhook is exempt from the session gate (which is
 * GET-only for everything else), the other two routes are NOT, and a blocked tenant has to be able
 * to reach them. The plan's own remaining Test — "a webhook with a bad signature changes nothing" —
 * is here too, as the shared secret this lane ships in place of a provider signature.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-billing-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "3f8a1c05d97e26b4084fa3c1e5d7290b6c48af13e02d95b7ca6318fd4e7092a5";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import { calendarMonthPeriod } from "@agentforge/core";
import { PLAN_CATALOG_CURRENCY, PLAN_TIERS } from "@agentforge/core/plans";
import { dispatch } from "../router";
import { createSession } from "../auth/session";
import { createMemorySessionStore } from "../auth/session-store";
import { BILLING_SECRET_ENV, BILLING_TOKEN_HEADER } from "../billing/authenticate";
import { isSessionExemptPath } from "../auth/routes";
import { currentPlanRecord, savePlanRecord } from "../entitlement-store";
import type { HostJsonResult, HostRequest, HostResult } from "../types";
import type { SessionStore } from "../auth/session-store";

const SECRET = "shared-secret-for-the-provider";
const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);
const IDENTITY = { tenantId: "billing-tenant-a", orgId: "billing-org-a", userId: "billing-user-a" };

let store: SessionStore;
let cookie: string;

function json(result: HostResult): HostJsonResult {
  if (result.type !== "json") {
    throw new Error(`expected a json result, got ${result.type}`);
  }
  return result;
}

function body(result: HostResult): Record<string, unknown> {
  return json(result).body as Record<string, unknown>;
}

function request(over: Partial<HostRequest> = {}): HostRequest {
  return {
    method: "POST",
    path: "/api/v1/billing/webhook",
    query: {},
    params: {},
    headers: {},
    ...over,
  };
}

/** A delivery as a provider adapter would hand it over. */
function delivery(over: Record<string, unknown> = {}): HostRequest {
  return request({
    headers: { [BILLING_TOKEN_HEADER]: SECRET },
    body: {
      eventId: "evt-1",
      tenantId: IDENTITY.tenantId,
      kind: "entitlement.set",
      occurredAt: T0,
      entitlement: { status: "active", allowanceUsdMicros: 5_000 },
      ...over,
    },
  });
}

async function send(req: HostRequest): Promise<HostResult> {
  return dispatch(req, { serverMode: true, sessionStore: store, now: () => T0 });
}

beforeAll(async () => {
  const { db, ensurePortalOwner } = await import("@agentforge/db");
  await ensurePortalOwner(db, IDENTITY);
  store = createMemorySessionStore();
  const session = createSession({ ...IDENTITY, now: T0 });
  await store.create(session);
  cookie = `__Host-agentforge_session=${session.id}`;
});

beforeEach(async () => {
  process.env.AGENTFORGE_SERVER = "1";
  process.env[BILLING_SECRET_ENV] = SECRET;
  const { db } = await import("@agentforge/db");
  // Each case starts from "the webhook has never spoken about this tenant".
  db.$client.prepare("DELETE FROM tenant_plan").run();
  db.$client.prepare("DELETE FROM billing_events").run();
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
  delete process.env[BILLING_SECRET_ENV];
  delete process.env.AGENTFORGE_BILLING_TOPUP_URL;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the webhook's exemptions", () => {
  it("is the one POST under /api that runs without a session", () => {
    expect(isSessionExemptPath("POST", "/api/v1/billing/webhook")).toBe(true);
    // And it is the ONLY one: the widening is a single literal path, not a prefix.
    expect(isSessionExemptPath("POST", "/api/v1/billing/top-up")).toBe(false);
    expect(isSessionExemptPath("POST", "/api/v1/settings")).toBe(false);
    expect(isSessionExemptPath("GET", "/api/v1/billing/webhook")).toBe(false);
  });

  it("answers a provider that presents no cookie at all", async () => {
    const result = await send(delivery());
    expect(json(result).status).toBe(200);
    expect(body(result)).toMatchObject({ received: true, outcome: "applied" });
  });

  it("still gates the two browser routes", async () => {
    expect(json(await send(request({ method: "GET", path: "/api/v1/billing/plan" }))).status).toBe(401);
    expect(json(await send(request({ path: "/api/v1/billing/top-up" }))).status).toBe(401);
  });
});

describe("authenticating a delivery", () => {
  it("changes nothing when the secret is wrong", async () => {
    // The plan's own Tests list: a webhook that does not authenticate changes nothing and says so.
    const result = await send(delivery());
    expect(currentPlanRecord(IDENTITY.tenantId, T0).allowanceUsdMicros).toBe(5_000);

    const forged = delivery({ eventId: "evt-forged", entitlement: { allowanceUsdMicros: 999_999_999 } });
    forged.headers[BILLING_TOKEN_HEADER] = "not-the-secret";
    const refused = await send(forged);

    expect(json(refused).status).toBe(401);
    expect(currentPlanRecord(IDENTITY.tenantId, T0).allowanceUsdMicros).toBe(5_000);
    expect(json(result).status).toBe(200);
  });

  it("changes nothing when no token is presented", async () => {
    const bare = delivery();
    delete bare.headers[BILLING_TOKEN_HEADER];
    expect(json(await send(bare)).status).toBe(401);
  });

  it("refuses everything when the deployment has no secret configured", async () => {
    // An open webhook is a route by which anybody can set any tenant's plan to active with an
    // unlimited allowance, so "unconfigured" must mean closed rather than open.
    delete process.env[BILLING_SECRET_ENV];
    const result = await send(delivery());
    expect(json(result).status).toBe(503);
    expect((body(result).error as { code: string }).code).toBe("billing_not_configured");
  });

  it("does not exist off server mode", async () => {
    delete process.env.AGENTFORGE_SERVER;
    const result = await dispatch(delivery(), { serverMode: false, sessionStore: store, now: () => T0 });
    expect(json(result).status).toBe(404);
  });
});

describe("applying a delivery", () => {
  it("writes the plan the event states", async () => {
    await send(
      delivery({ entitlement: { kind: "enterprise", status: "active", allowanceUsdMicros: 7_000, seatCap: 12 } }),
    );
    expect(currentPlanRecord(IDENTITY.tenantId, T0)).toMatchObject({
      kind: "enterprise",
      status: "active",
      allowanceUsdMicros: 7_000,
      seatCap: 12,
    });
  });

  it("writes once for a delivery sent twice", async () => {
    // Xendit retries up to six times; every provider retries. The webhook is the only writer of
    // `status`, so a replay must be a no-op and must still answer 200 or the retries never stop.
    await send(delivery({ entitlement: { allowanceUsdMicros: 5_000 } }));
    savePlanRecord({ ...currentPlanRecord(IDENTITY.tenantId, T0), spentUsdMicros: 4_000, updatedAt: T0 });

    const replay = await send(delivery({ entitlement: { allowanceUsdMicros: 5_000 } }));

    expect(json(replay).status).toBe(200);
    expect(body(replay)).toMatchObject({ outcome: "duplicate" });
    expect(currentPlanRecord(IDENTITY.tenantId, T0).spentUsdMicros).toBe(4_000);
  });

  /**
   * Found by driving the real webhook on the review instance.
   *
   * An adapter that spelled the patch `data` instead of `entitlement` was answered
   * `200 {"outcome":"applied"}` on every single delivery while the plan row never moved — the
   * parser is deliberately forgiving about fields it cannot read (`@agentforge/core`'s
   * `webhook.ts`), so what arrived was a well-formed `entitlement.set` that stated nothing, and
   * the route wrote the record back exactly as it found it. `applied` meant "this route ran", not
   * "this tenant's entitlement changed", and nothing anywhere recorded the difference: the
   * provider's dashboard reads green while an operator watches a tenant that will not go active,
   * and the two facts never meet.
   *
   * Still 200 and still recorded, because a non-2xx to a provider is a retry and a retry cannot
   * fix a wrong field name. What changes is that the answer, the log line and the `billing_events`
   * row all say `no_change`, which is true and is searchable.
   */
  it("says no_change for an entitlement.set that states nothing, and writes nothing", async () => {
    await send(delivery({ eventId: "evt-base", entitlement: { status: "active", seatCap: 7 } }));
    const before = currentPlanRecord(IDENTITY.tenantId, T0);

    const empty = await send(
      delivery({ eventId: "evt-empty", occurredAt: T0 + 1_000, entitlement: undefined, data: { seatCap: 99 } }),
    );

    expect(json(empty).status).toBe(200);
    expect(body(empty)).toMatchObject({ received: true, outcome: "no_change" });
    const after = currentPlanRecord(IDENTITY.tenantId, T0);
    expect(after.seatCap).toBe(before.seatCap);
    expect(after.status).toBe(before.status);
  });

  it("drops a delivery that arrived out of order", async () => {
    await send(delivery({ eventId: "evt-new", occurredAt: T0, entitlement: { status: "active" } }));
    const stale = await send(
      delivery({ eventId: "evt-old", occurredAt: T0 - 60_000, entitlement: { status: "past_due" } }),
    );

    expect(body(stale)).toMatchObject({ outcome: "stale" });
    // A retried `past_due` must not land on top of the `active` that already fixed it.
    expect(currentPlanRecord(IDENTITY.tenantId, T0).status).toBe("active");
  });

  it("applies a delivery whose timestamp precedes the tenant's last generation", async () => {
    // The regression this route shipped with. `accrueSpend` — every ledger write — bumps
    // `tenant_plan.updated_at`, and the ordering test used to compare against that column. A
    // provider's `occurred_at` always precedes its delivery, so any tenant that was still
    // generating could never be topped up, have its seat cap raised, or receive any
    // `entitlement.set` again: every one of them read as `stale` forever.
    await send(delivery({ eventId: "evt-sold", occurredAt: T0 - 3_600_000 }));

    const { accrueSpend } = await import("../entitlement-store");
    accrueSpend({ tenantId: IDENTITY.tenantId, costUsdMicros: 500, nowMs: T0 });
    // The mechanism, asserted rather than assumed: the row is now newer than the delivery below.
    expect(currentPlanRecord(IDENTITY.tenantId, T0).updatedAt).toBe(T0);

    const topUp = await send(
      delivery({ eventId: "evt-topup", kind: "allowance.topup", occurredAt: T0 - 30_000, topUpUsdMicros: 1_000 }),
    );

    expect(body(topUp)).toMatchObject({ outcome: "applied" });
    expect(currentPlanRecord(IDENTITY.tenantId, T0).allowanceUsdMicros).toBe(6_000);
  });

  it("still refuses a delivery older than the last one it applied", async () => {
    // The other half of the same rule: moving the bar to the last applied webhook must not stop
    // the webhook ordering itself. A generation in between changes nothing about this.
    await send(delivery({ eventId: "evt-new", occurredAt: T0, entitlement: { status: "active" } }));
    const { accrueSpend } = await import("../entitlement-store");
    accrueSpend({ tenantId: IDENTITY.tenantId, costUsdMicros: 10, nowMs: T0 });

    const stale = await send(
      delivery({ eventId: "evt-old", occurredAt: T0 - 60_000, entitlement: { status: "past_due" } }),
    );

    expect(body(stale)).toMatchObject({ outcome: "stale" });
    expect(currentPlanRecord(IDENTITY.tenantId, T0).status).toBe("active");
  });

  it("lets a retry land the sale once the tenant has signed in", async () => {
    // A plan sold before first sign-in. The delivery is stored unapplied; the provider's retry
    // after the tenant exists must apply it rather than read as `duplicate` forever.
    const late = { tenantId: "billing-tenant-late", orgId: "billing-org-late", userId: "billing-user-late" };
    const first = await send(delivery({ eventId: "evt-presold", tenantId: late.tenantId }));
    expect(body(first)).toMatchObject({ outcome: "unknown_tenant" });

    const { db, ensurePortalOwner } = await import("@agentforge/db");
    await ensurePortalOwner(db, late);

    const retry = await send(delivery({ eventId: "evt-presold", tenantId: late.tenantId }));

    expect(body(retry)).toMatchObject({ outcome: "applied" });
    expect(currentPlanRecord(late.tenantId, T0).allowanceUsdMicros).toBe(5_000);
    // And the row is promoted, so a third delivery of the same id is a duplicate again.
    const again = await send(delivery({ eventId: "evt-presold", tenantId: late.tenantId }));
    expect(body(again)).toMatchObject({ outcome: "duplicate" });
    db.$client.prepare("DELETE FROM tenant_plan WHERE tenant_id = ?").run(late.tenantId);
  });

  it("records a delivery for a tenant it has never heard of instead of dropping it", async () => {
    const result = await send(delivery({ eventId: "evt-early", tenantId: "tenant-not-provisioned" }));
    expect(json(result).status).toBe(200);
    expect(body(result)).toMatchObject({ outcome: "unknown_tenant" });

    const { db } = await import("@agentforge/db");
    const row = db.$client
      .prepare("SELECT applied, detail FROM billing_events WHERE event_id = 'evt-early'")
      .get() as { applied: number; detail: string };
    // Stored unapplied, with the reason: the provider can retire the event, and an operator can
    // see exactly what is waiting on a sign-in that has not happened yet.
    expect(row).toEqual({ applied: 0, detail: "unknown_tenant" });
  });

  it("400s an unreadable body rather than pretending it landed", async () => {
    // The one non-2xx to an authenticated caller. A retry does not fix a broken adapter, and a 200
    // would hide it behind a green dashboard.
    const result = await send(request({ headers: { [BILLING_TOKEN_HEADER]: SECRET }, body: { kind: "nonsense" } }));
    expect(json(result).status).toBe(400);
  });

  it("unblocks a blocked tenant on the next call", async () => {
    // The plan's done-when, end to end: blocked, webhook, unblocked.
    savePlanRecord({
      ...currentPlanRecord(IDENTITY.tenantId, T0),
      allowanceUsdMicros: 100,
      spentUsdMicros: 100,
      ...calendarMonthPeriod(T0),
      updatedAt: T0 - 1,
    });
    const blockedBefore = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(body(blockedBefore).block).toBe("plan_allowance_exhausted");

    await send(delivery({ eventId: "evt-topup", kind: "allowance.topup", topUpUsdMicros: 900 }));

    const after = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(body(after)).toMatchObject({ block: null, allowanceUsdMicros: 1_000 });
  });
});

describe("the account screen's two routes", () => {
  it("reports a tenant the webhook has never spoken about as active and uncapped", async () => {
    const result = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(body(result)).toMatchObject({
      enforced: true,
      status: "active",
      allowanceUsdMicros: null,
      block: null,
      seatsInUse: 0,
    });
  });

  it("answers a blocked tenant rather than refusing it", async () => {
    // A blocked tenant that cannot see why it is blocked, or pay, is a churned tenant. These two
    // routes are deliberately not behind the gateway gate for that reason.
    savePlanRecord({
      ...currentPlanRecord(IDENTITY.tenantId, T0),
      status: "past_due",
      ...calendarMonthPeriod(T0),
      updatedAt: T0,
    });
    const plan = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(json(plan).status).toBe(200);
    expect(body(plan).block).toBe("plan_past_due");

    const topUp = await send(request({ path: "/api/v1/billing/top-up", headers: { cookie } }));
    expect(json(topUp).status).toBe(200);
  });

  it("says a top-up is unavailable when no provider is configured, rather than inventing one", async () => {
    const result = await send(request({ path: "/api/v1/billing/top-up", headers: { cookie } }));
    expect(body(result)).toMatchObject({ available: false, reason: "billing_provider_not_configured" });
  });

  it("hands back the operator's payment link when there is one", async () => {
    process.env.AGENTFORGE_BILLING_TOPUP_URL = "https://pay.example.test/topup";
    const result = await send(request({ path: "/api/v1/billing/top-up", headers: { cookie } }));
    expect(body(result)).toMatchObject({ available: true, checkoutUrl: "https://pay.example.test/topup" });
  });

  /**
   * The variable was echoed unvalidated, and the renderer turns it into an `href` on a page inside
   * the tenant's session. A mis-set environment variable must not become script execution, and an
   * `available: true` with nothing openable behind it is a dead button either way.
   */
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "/topup",
    "pay.example.test/topup",
    "   ",
  ])("refuses %s rather than echoing it as a checkout link", async (value) => {
    process.env.AGENTFORGE_BILLING_TOPUP_URL = value;
    const result = await send(request({ path: "/api/v1/billing/top-up", headers: { cookie } }));
    expect(body(result)).toMatchObject({ available: false, reason: "billing_provider_not_configured" });
    if (value.trim()) {
      // And the bad value is nowhere in the answer, not even as a reason.
      expect(JSON.stringify(body(result))).not.toContain(value.trim());
    }
  });

  /**
   * A tenant with no `tenant_plan` row has been sold nothing, and the account screen has to say so.
   *
   * This read used to label from `currentPlanRecord`, which fills in `defaultPlanRecord` —
   * personal, `seatCap: null`, `active` — so that entitlement enforcement fails OPEN. Those are
   * exactly the Personal tier's two columns, so `matchTier` named it, and every tenant nobody had
   * sold anything to was told on Settings that they were on Personal / Active.
   */
  it("says a tenant nobody has sold anything to is on no tier", async () => {
    const fresh = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(body(fresh).tierId).toBeNull();
    // The fail-open default is still what enforcement reads: the label changed, not the rules.
    expect(body(fresh)).toMatchObject({ enforced: true, kind: "personal", status: "active", block: null });
  });

  it("labels the stored plan with the catalog tier it was cut from", async () => {
    // The host stores an entitlement, not a tier. `matchTier` is what turns the kind and the seat
    // cap back into a name the account screen can print — once there is a row to read it off.
    await send(delivery({ eventId: "evt-personal", entitlement: { kind: "personal", seatCap: null } }));
    const personal = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(body(personal).tierId).toBe("personal");

    await send(delivery({ eventId: "evt-ent", entitlement: { kind: "enterprise", seatCap: 20 } }));
    const enterprise = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(body(enterprise)).toMatchObject({ kind: "enterprise", seatCap: 20, tierId: "enterprise" });

    // A hand-set cap matches no tier, and saying `null` is better than guessing at a name.
    await send(delivery({ eventId: "evt-odd", entitlement: { kind: "enterprise", seatCap: 7 } }));
    const custom = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(body(custom).tierId).toBeNull();
  });

  it("carries no token field of any kind — nobody is metered against a token budget", async () => {
    const result = await send(request({ method: "GET", path: "/api/v1/billing/plan", headers: { cookie } }));
    expect(JSON.stringify(body(result)).toLowerCase()).not.toContain("token");
  });

  it("never raises an allowance by itself — only the webhook does", async () => {
    process.env.AGENTFORGE_BILLING_TOPUP_URL = "https://pay.example.test/topup";
    savePlanRecord({
      ...currentPlanRecord(IDENTITY.tenantId, T0),
      allowanceUsdMicros: 100,
      ...calendarMonthPeriod(T0),
      updatedAt: T0,
    });

    await send(request({ path: "/api/v1/billing/top-up", headers: { cookie } }));

    // The host does not sell itself credit. The allowance moves when the provider's event comes
    // back through the webhook, which is what makes the purchase auditable.
    expect(currentPlanRecord(IDENTITY.tenantId, T0).allowanceUsdMicros).toBe(100);
  });
});

/**
 * Phase 9 lane F — `GET /api/v1/billing/plans`, what the pricing page and the plan panel render.
 *
 * The catalog itself is a pure module the renderer can import (`@agentforge/core/plans`), so this
 * route exists for the one thing an import cannot answer: which tier THIS tenant is on.
 */
describe("GET /api/v1/billing/plans", () => {
  const plans = (over: Partial<HostRequest> = {}) => request({ method: "GET", path: "/api/v1/billing/plans", ...over });

  it("needs a session on the hosted server — it is not an ungated read", async () => {
    expect(isSessionExemptPath("GET", "/api/v1/billing/plans")).toBe(false);
    expect(json(await send(plans())).status).toBe(401);
  });

  it("answers the catalog, and no current tier for a tenant with no plan row", async () => {
    // `current` is what makes the pricing page replace a CTA with "This is your plan". Reading it
    // off the fail-open default put that badge on Personal for everybody who had never bought
    // anything — a price list telling a stranger they had already paid.
    const result = await send(plans({ headers: { cookie } }));
    expect(json(result).status).toBe(200);
    expect(body(result)).toEqual({
      currency: PLAN_CATALOG_CURRENCY,
      tiers: PLAN_TIERS,
      current: null,
    });
  });

  it("names the tier once one has actually been sold", async () => {
    await send(delivery({ eventId: "evt-plans-personal", entitlement: { kind: "personal", seatCap: null } }));
    expect(body(await send(plans({ headers: { cookie } }))).current).toBe("personal");
  });

  it("is exactly the two owner-approved tiers, and no token allowance", () => {
    expect(PLAN_TIERS.map((tier) => tier.id)).toEqual(["personal", "enterprise"]);
    expect(JSON.stringify(PLAN_TIERS).toLowerCase()).not.toContain("token");
  });

  it("follows the tenant's plan when the webhook moves it", async () => {
    await send(delivery({ eventId: "evt-plans-ent", entitlement: { kind: "enterprise", seatCap: 20 } }));
    expect(body(await send(plans({ headers: { cookie } }))).current).toBe("enterprise");
  });

  it("reports no tier rather than guessing when the stored plan matches none", async () => {
    await send(delivery({ eventId: "evt-plans-odd", entitlement: { kind: "enterprise", seatCap: 3 } }));
    expect(body(await send(plans({ headers: { cookie } }))).current).toBeNull();
  });

  it("answers the catalog off server mode so a desk can render pricing", async () => {
    // No session exists off server mode, and a desk has no plan: the catalog, and `current: null`.
    delete process.env.AGENTFORGE_SERVER;
    const result = await dispatch(plans(), { serverMode: false, sessionStore: store, now: () => T0 });
    expect(json(result).status).toBe(200);
    expect(body(result)).toEqual({ currency: PLAN_CATALOG_CURRENCY, tiers: PLAN_TIERS, current: null });
  });

  it("is not behind the gateway gate: a blocked tenant can still read what it could buy", async () => {
    savePlanRecord({
      ...currentPlanRecord(IDENTITY.tenantId, T0),
      status: "past_due",
      ...calendarMonthPeriod(T0),
      updatedAt: T0,
    });
    const result = await send(plans({ headers: { cookie } }));
    expect(json(result).status).toBe(200);
    expect(body(result).tiers).toEqual(PLAN_TIERS);
  });
});

/**
 * Rule 4 of the lane: off server mode nothing this lane touched may change. Driven rather than
 * asserted in prose, because "hosted only by construction" is only true while a test says so.
 */
describe("off server mode", () => {
  const off = (over: Partial<HostRequest>) =>
    dispatch(request(over), { serverMode: false, sessionStore: store, now: () => T0 });

  beforeEach(() => {
    delete process.env.AGENTFORGE_SERVER;
  });

  it("still answers GET /api/v1/billing/plan with exactly { enforced: false }", async () => {
    const result = await off({ method: "GET", path: "/api/v1/billing/plan" });
    expect(json(result).status).toBe(200);
    // Byte-identical to Phase 5: no `tierId`, no plan fields, nothing a desk has to branch on.
    expect(body(result)).toEqual({ enforced: false });
  });

  it("still 404s the webhook and the top-up", async () => {
    expect(json(await off({ path: "/api/v1/billing/webhook" })).status).toBe(404);
    expect(json(await off({ path: "/api/v1/billing/top-up" })).status).toBe(404);
  });

  it("still 404s the new login start route", async () => {
    // `hostAuthRoutes()` caches `isServerMode()` at first use, so this case owns that wiring rather
    // than inheriting whatever an earlier test in this file happened to construct.
    const { resetHostAuthForTests } = await import("../auth");
    resetHostAuthForTests();
    expect(json(await off({ method: "GET", path: "/api/v1/auth/start" })).status).toBe(404);
    resetHostAuthForTests();
  });
});
