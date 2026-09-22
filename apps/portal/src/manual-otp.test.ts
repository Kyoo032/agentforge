/** The operator path: opt-in, enumeration-resistant, audited, and never a read of a stored code. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type PortalConfig } from "./config";
import { issueManualOtp } from "./manual-otp";
import type { PortalStore } from "./store/types";
import { seedFixture, type Fixture } from "./testing/fixtures";
import { createTestStore, type TestStore } from "./testing/pg";

let harness: TestStore;
let store: PortalStore;
let fixture: Fixture;
let allowed: PortalConfig;
let refused: PortalConfig;

beforeAll(async () => {
  harness = await createTestStore();
  store = harness.store;
  fixture = await seedFixture(store, { email: "operator@example.test" });

  const base = { PORTAL_DATA_DIR: process.cwd(), PORTAL_DATABASE_URL: harness.database.url };
  allowed = loadConfig({ ...base, PORTAL_ALLOW_MANUAL_OTP: "1" });
  refused = loadConfig(base);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe("issueManualOtp", () => {
  it("refuses unless PORTAL_ALLOW_MANUAL_OTP is set", async () => {
    const result = await issueManualOtp(refused, store, { email: "operator@example.test" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_allowed");
  });

  it("mints a fresh code that verifies exactly once", async () => {
    const result = await issueManualOtp(allowed, store, { email: "operator@example.test" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.tenantId).toBe(fixture.tenant.id);

    // The purpose is named rather than left to two defaults agreeing, which is exactly how the
    // mismatch below went unnoticed: this file defaulted to `activate` and so did the store's
    // verify, so the pair passed while the browser flow — which asks for `portal_login` — did not.
    const verify = () =>
      store.tx(fixture.tenant.id, (ops) =>
        ops.loginOtps.verify({
          tenantId: fixture.tenant.id,
          email: "operator@example.test",
          code: result.code,
          purpose: "portal_login",
        }),
      );
    expect((await verify()).ok).toBe(true);
    expect((await verify()).ok).toBe(false);
  });

  /**
   * The bug this pins, found by driving the hosted sign-in end to end.
   *
   * `login_otps` rows carry a `purpose`, and the store's verify matches on it. The browser login
   * (`routes/authorize.ts` `postVerify` → `otp/verify.ts`) asks for `portal_login`; this function
   * defaulted to `activate`, which is the device-code flow's purpose and the only one that existed
   * when it was written. So `pnpm portal:otp <email>` printed a perfectly live code that
   * `/authorize/verify` then refused as `no_code` — and that refusal is deliberately identical to
   * the one an address with no code at all gets, so it says nothing about why.
   *
   * This is the whole operator path while no mail provider is bound (owner ruling 4,
   * `web-phase9-portal-login.md`), so the browser login's purpose is the one it must default to.
   */
  it("mints a code the BROWSER sign-in accepts, which is what an operator hands out", async () => {
    const result = await issueManualOtp(allowed, store, { email: "operator@example.test" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const verified = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginOtps.verify({
        tenantId: fixture.tenant.id,
        email: "operator@example.test",
        code: result.code,
        // Exactly what `otp/verify.ts` passes for the browser flow.
        purpose: "portal_login",
      }),
    );
    expect(verified.ok).toBe(true);
  });

  it("still mints an activate code for the device flow when it is asked for one", async () => {
    const result = await issueManualOtp(allowed, store, {
      email: "operator@example.test",
      purpose: "activate",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const verified = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginOtps.verify({
        tenantId: fixture.tenant.id,
        email: "operator@example.test",
        code: result.code,
        purpose: "activate",
      }),
    );
    expect(verified.ok).toBe(true);
  });

  it("writes otp.issued_manually, so a hand-over leaves the same trail a mailed code does", async () => {
    await issueManualOtp(allowed, store, { email: "operator@example.test" });
    const entries = await store.tx(fixture.tenant.id, (ops) =>
      ops.audit.list({ tenantId: fixture.tenant.id, action: "otp.issued_manually" }),
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].actorKind).toBe("support");
    // The row records that a code was issued, never the code.
    expect(JSON.stringify(entries[0])).not.toMatch(/"\d{6}"/);
  });

  it("answers the same way for an unknown address as for an ambiguous one", async () => {
    const unknown = await issueManualOtp(allowed, store, { email: "nobody@example.test" });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.reason).toBe("unknown_address");

    // The same address in two tenants resolves to nothing, by design.
    const other = await seedFixture(store, { email: "shared@example.test" });
    await seedFixture(store, { email: "shared@example.test" });
    expect(other.user.email).toBe("shared@example.test");

    const ambiguous = await issueManualOtp(allowed, store, { email: "shared@example.test" });
    expect(ambiguous.ok).toBe(false);
    if (ambiguous.ok) return;
    expect(ambiguous.reason).toBe("unknown_address");
  });

  it("is still bound by the three-per-fifteen-minutes send limit", async () => {
    const fresh = await seedFixture(store, { email: "busy@example.test" });
    expect(fresh.user.email).toBe("busy@example.test");
    for (let i = 0; i < 3; i += 1) {
      const sent = await issueManualOtp(allowed, store, { email: "busy@example.test" });
      expect(sent.ok).toBe(true);
    }
    const fourth = await issueManualOtp(allowed, store, { email: "busy@example.test" });
    expect(fourth.ok).toBe(false);
    if (fourth.ok) return;
    expect(fourth.reason).toBe("send_rate_limited");
  });
});
