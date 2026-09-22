/** The device-code state machine, its poll limits, and its single use. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomToken } from "../../crypto";
import { addDevice, seedFixture, type Fixture } from "../../testing/fixtures";
import { createTestStore, fixedClock, type TestStore } from "../../testing/pg";
import type { DeviceCode, PortalStore } from "../types";

let harness: TestStore;
let store: PortalStore;
let fixture: Fixture;
const clock = fixedClock();

beforeAll(async () => {
  harness = await createTestStore(clock);
  store = harness.store;
  fixture = await seedFixture(store);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

interface Started {
  readonly raw: string;
  readonly installId: string;
  readonly code: DeviceCode;
}

async function start(options: { ttlMs?: number; tenantId?: string | null } = {}): Promise<Started> {
  clock.set(new Date());
  const raw = randomToken();
  const installId = randomUUID();
  const code = await store.tx(options.tenantId ?? null, (ops) =>
    ops.deviceCodes.create({
      rawDeviceCode: raw,
      installId,
      platform: "windows",
      clientName: "DPSBuddy",
      clientVersion: "0.14.27",
      tenantId: options.tenantId ?? null,
      ttlMs: options.ttlMs,
    }),
  );
  return { raw, installId, code };
}

async function approve(started: Started): Promise<DeviceCode> {
  const device = await addDevice(store, fixture, fixture.user, started.installId);
  const result = await store.tx(fixture.tenant.id, (ops) =>
    ops.deviceCodes.approve({
      userCode: started.code.userCode,
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      userId: fixture.user.id,
      deviceId: device.id,
    }),
  );
  if (!result.ok) {
    throw new Error(`approve refused: ${result.reason}`);
  }
  return result.code;
}

describe("device codes", () => {
  it("mints a pending code with a typeable user_code and a hashed device code", async () => {
    const started = await start();
    expect(started.code.status).toBe("pending");
    expect(started.code.userCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    expect(started.code.intervalSeconds).toBe(5);
    expect(started.code.platform).toBe("windows");
    // Nothing in the returned row is the raw code.
    expect(JSON.stringify(started.code)).not.toContain(started.raw);
  });

  it("answers authorization_pending while nobody has approved", async () => {
    const started = await start();
    const result = await store.pollDeviceCode(started.raw, started.installId);
    expect(result.reason).toBe("authorization_pending");
  });

  it("answers slow_down on the third poll inside one interval, and widens the interval", async () => {
    const started = await start();
    expect((await store.pollDeviceCode(started.raw, started.installId)).reason).toBe("authorization_pending");
    expect((await store.pollDeviceCode(started.raw, started.installId)).reason).toBe("authorization_pending");

    const third = await store.pollDeviceCode(started.raw, started.installId);
    expect(third.reason).toBe("slow_down");
    if (third.reason !== "slow_down") return;
    expect(third.intervalSeconds).toBe(10);
    expect(third.retryAfter).toBe(10);
  });

  it("forgives a client that waits out the interval", async () => {
    const started = await start();
    await store.pollDeviceCode(started.raw, started.installId);
    await store.pollDeviceCode(started.raw, started.installId);
    clock.advance(6_000);
    const afterWait = await store.pollDeviceCode(started.raw, started.installId);
    expect(afterWait.reason).toBe("authorization_pending");
  });

  it("force-expires a code after 200 polls", async () => {
    // A long TTL on purpose: this is the *poll* ceiling, and a code that lapsed on the clock
    // instead would answer device_code_expired for the wrong reason and prove nothing.
    const started = await start({ ttlMs: 4 * 60 * 60 * 1000 });
    // One poll per interval window, so an honest pace is never mistaken for abuse.
    for (let i = 0; i < 199; i += 1) {
      clock.advance(6_000);
      await store.pollDeviceCode(started.raw, started.installId);
    }
    clock.advance(6_000);
    const twoHundredth = await store.pollDeviceCode(started.raw, started.installId);
    expect(twoHundredth.reason).toBe("authorization_pending");

    clock.advance(6_000);
    const result = await store.pollDeviceCode(started.raw, started.installId);
    expect(result.reason).toBe("device_code_expired");

    const row = await store.tx(null, (ops) => ops.deviceCodes.findByUserCode(started.code.userCode));
    expect(row?.status).toBe("expired");
    expect(row?.pollCount).toBe(201);
  }, 60_000);

  it("refuses a poll whose install_id does not match the row, without counting it", async () => {
    const started = await start();
    const result = await store.pollDeviceCode(started.raw, randomUUID());
    expect(result.reason).toBe("invalid_grant");

    const row = await store.tx(null, (ops) => ops.deviceCodes.findByUserCode(started.code.userCode));
    expect(row?.pollCount).toBe(0);
  });

  it("answers invalid_grant for a device code that was never minted", async () => {
    const result = await store.pollDeviceCode(randomToken(), randomUUID());
    expect(result.reason).toBe("invalid_grant");
  });

  it("answers device_code_expired once the TTL has passed", async () => {
    const started = await start({ ttlMs: -1_000 });
    const result = await store.pollDeviceCode(started.raw, started.installId);
    expect(result.reason).toBe("device_code_expired");
  });

  it("approves into ok, then redeems exactly once", async () => {
    const started = await start();
    const approved = await approve(started);
    expect(approved.status).toBe("approved");
    expect(approved.tenantId).toBe(fixture.tenant.id);
    expect(approved.orgId).toBe(fixture.org.id);
    expect(approved.deviceId).not.toBeNull();

    const polled = await store.pollDeviceCode(started.raw, started.installId);
    expect(polled.reason).toBe("ok");

    const session = await store.tx(fixture.tenant.id, async (ops) => {
      const created = await ops.sessions.create({
        tenantId: fixture.tenant.id,
        orgId: fixture.org.id,
        userId: fixture.user.id,
        deviceId: String(approved.deviceId),
      });
      const redeemed = await ops.deviceCodes.redeem({ rawDeviceCode: started.raw, sessionId: created.id });
      expect(redeemed?.status).toBe("redeemed");
      return created;
    });

    // A second redemption of the same code gets nothing...
    const second = await store.tx(fixture.tenant.id, (ops) =>
      ops.deviceCodes.redeem({ rawDeviceCode: started.raw, sessionId: session.id }),
    );
    expect(second).toBeNull();
    // ...and a replayed poll is an invalid grant, not another session.
    const replay = await store.pollDeviceCode(started.raw, started.installId);
    expect(replay.reason).toBe("invalid_grant");
  });

  it("answers device_code_denied after a deny, and cannot be approved afterwards", async () => {
    const started = await start();
    const denied = await store.tx(null, (ops) => ops.deviceCodes.deny(started.code.userCode));
    expect(denied.ok).toBe(true);

    const polled = await store.pollDeviceCode(started.raw, started.installId);
    expect(polled.reason).toBe("device_code_denied");

    const device = await addDevice(store, fixture, fixture.user, started.installId);
    const approved = await store.tx(fixture.tenant.id, (ops) =>
      ops.deviceCodes.approve({
        userCode: started.code.userCode,
        tenantId: fixture.tenant.id,
        orgId: fixture.org.id,
        userId: fixture.user.id,
        deviceId: device.id,
      }),
    );
    expect(approved.ok).toBe(false);
  });

  it("refuses to approve a code minted for another tenant", async () => {
    const other = await seedFixture(store);
    const started = await start({ tenantId: other.tenant.id });
    const device = await addDevice(store, fixture, fixture.user, started.installId);

    const result = await store.tx(fixture.tenant.id, (ops) =>
      ops.deviceCodes.approve({
        userCode: started.code.userCode,
        tenantId: fixture.tenant.id,
        orgId: fixture.org.id,
        userId: fixture.user.id,
        deviceId: device.id,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // `device_code_expired`, not `tenant_inactive`, and that is RLS doing its job rather than a
    // regression. `p_device_codes_app` (0004_rls.sql) is
    // `USING (tenant_id IS NULL OR tenant_id = app_tenant_id())`, so under the real `portal_app`
    // role the other tenant's row is not visible to the `SELECT ... FOR UPDATE` at the top of
    // `approve` and the handler never reaches its own tenant-mismatch branch
    // (`./device-codes.ts:108-110`, now unreachable in production). This expectation said
    // `tenant_inactive` while the suite connected as the cluster superuser, which bypasses RLS --
    // see the header of `src/testing/pg.ts` for why it no longer does.
    expect(result.reason).toBe("device_code_expired");
  });

  it("accepts a user_code typed without the dash, in any case", async () => {
    const started = await start();
    const bare = started.code.userCode.replace("-", "").toLowerCase();
    const found = await store.tx(null, (ops) => ops.deviceCodes.findByUserCode(bare));
    expect(found?.id).toBe(started.code.id);
  });

  it("expire_device_codes() sweeps lapsed rows", async () => {
    const started = await start({ ttlMs: -1_000 });
    const swept = await store.tx(null, (ops) => ops.deviceCodes.expireDue());
    expect(swept).toBeGreaterThanOrEqual(1);
    const row = await store.tx(null, (ops) => ops.deviceCodes.findByUserCode(started.code.userCode));
    expect(row?.status).toBe("expired");
  });
});
