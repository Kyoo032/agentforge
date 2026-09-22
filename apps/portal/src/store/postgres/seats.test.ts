/**
 * `count_active_users` and `login_precheck` — the seat definition and the login gate, as the
 * plpgsql functions in `0005_functions.sql` implement them.
 *
 * "Active user" = `users.status = 'active'` AND at least one non-revoked session seen in the last
 * 30 days. Nothing in TypeScript re-states that; these tests are here to prove the store is asking
 * the right question of the right function.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDevice, addUser, seedFixture, type Fixture } from "../../testing/fixtures";
import { createTestStore, type TestStore } from "../../testing/pg";
import type { PortalStore, User } from "../types";

let harness: TestStore;
let store: PortalStore;

beforeAll(async () => {
  harness = await createTestStore();
  store = harness.store;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const THIRTY_ONE_DAYS_MS = 31 * 24 * 60 * 60 * 1000;

async function signIn(fixture: Fixture, user: User, options: { lastSeenAt?: Date } = {}) {
  const device = await addDevice(store, fixture, user, randomUUID());
  return store.tx(fixture.tenant.id, async (ops) => {
    const session = await ops.sessions.create({
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      userId: user.id,
      deviceId: device.id,
      lastSeenAt: options.lastSeenAt?.toISOString(),
    });
    return { session, device };
  });
}

function countSeats(fixture: Fixture): Promise<number> {
  return store.tx(fixture.tenant.id, (ops) => ops.orgs.countActiveUsers(fixture.org.id));
}

describe("count_active_users", () => {
  it("counts nobody until someone has a live session", async () => {
    const fixture = await seedFixture(store);
    expect(await countSeats(fixture)).toBe(0);
    await signIn(fixture, fixture.user);
    expect(await countSeats(fixture)).toBe(1);
  });

  it("counts a person once however many devices they are on", async () => {
    const fixture = await seedFixture(store);
    await signIn(fixture, fixture.user);
    await signIn(fixture, fixture.user);
    expect(await countSeats(fixture)).toBe(1);
  });

  it("stops counting a session that was revoked", async () => {
    const fixture = await seedFixture(store);
    const { session } = await signIn(fixture, fixture.user);
    expect(await countSeats(fixture)).toBe(1);
    await store.tx(fixture.tenant.id, (ops) => ops.sessions.revoke(session.id, "logout"));
    expect(await countSeats(fixture)).toBe(0);
  });

  it("stops counting a session last seen more than 30 days ago", async () => {
    const fixture = await seedFixture(store);
    await signIn(fixture, fixture.user, { lastSeenAt: new Date(Date.now() - THIRTY_ONE_DAYS_MS) });
    expect(await countSeats(fixture)).toBe(0);
  });

  it("stops counting a user an admin disabled", async () => {
    const fixture = await seedFixture(store);
    await signIn(fixture, fixture.user);
    await store.tx(fixture.tenant.id, (ops) => ops.users.setStatus(fixture.user.id, "disabled"));
    expect(await countSeats(fixture)).toBe(0);
  });
});

describe("login_precheck", () => {
  it("passes a healthy first login", async () => {
    const fixture = await seedFixture(store);
    const device = await addDevice(store, fixture, fixture.user);
    const reason = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginPrecheck({ userId: fixture.user.id, deviceId: device.id }),
    );
    expect(reason).toBe("ok");
  });

  it("reports seat_cap_reached for the user who would exceed the cap", async () => {
    const fixture = await seedFixture(store, { seatCap: 1 });
    await signIn(fixture, fixture.user);
    expect(await countSeats(fixture)).toBe(1);

    const second = await addUser(store, fixture, "second@example.test");
    const device = await addDevice(store, fixture, second);
    const reason = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginPrecheck({ userId: second.id, deviceId: device.id }),
    );
    expect(reason).toBe("seat_cap_reached");
  });

  it("does not charge a second seat to someone already inside the active set", async () => {
    const fixture = await seedFixture(store, { seatCap: 1 });
    await signIn(fixture, fixture.user);
    const anotherDevice = await addDevice(store, fixture, fixture.user, randomUUID());
    const reason = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginPrecheck({ userId: fixture.user.id, deviceId: anotherDevice.id }),
    );
    expect(reason).toBe("ok");
  });

  it("skips the seat check on a refresh, which cannot grow the active set", async () => {
    const fixture = await seedFixture(store, { seatCap: 1 });
    await signIn(fixture, fixture.user);
    const second = await addUser(store, fixture, "third@example.test");
    const { session, device } = await signIn(fixture, second);

    // The org is now over its cap, but an existing session may still refresh.
    const reason = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginPrecheck({ userId: second.id, deviceId: device.id, sessionId: session.id }),
    );
    expect(reason).toBe("ok");
  });

  it("reports the outermost failing scope first", async () => {
    const fixture = await seedFixture(store);
    const device = await addDevice(store, fixture, fixture.user);
    const precheck = () =>
      store.tx(fixture.tenant.id, (ops) =>
        ops.loginPrecheck({ userId: fixture.user.id, deviceId: device.id }),
      );

    await store.tx(fixture.tenant.id, (ops) => ops.orgs.setStatus(fixture.org.id, "past_due"));
    expect(await precheck()).toBe("org_past_due");

    await store.tx(fixture.tenant.id, (ops) => ops.orgs.setStatus(fixture.org.id, "suspended"));
    expect(await precheck()).toBe("org_inactive");

    // A suspended tenant outranks everything below it and leaks no per-user state.
    await store.tx(fixture.tenant.id, (ops) => ops.tenants.setStatus(fixture.tenant.id, "suspended"));
    expect(await precheck()).toBe("tenant_inactive");
  });

  it("reports device_revoked for a device an admin signed out", async () => {
    const fixture = await seedFixture(store);
    const device = await addDevice(store, fixture, fixture.user);
    await store.tx(fixture.tenant.id, (ops) => ops.devices.revoke(device.id, "admin"));
    const reason = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginPrecheck({ userId: fixture.user.id, deviceId: device.id }),
    );
    expect(reason).toBe("device_revoked");
  });

  it("reports user_inactive — never a distinct 'not found' — for an unknown user", async () => {
    const fixture = await seedFixture(store);
    const device = await addDevice(store, fixture, fixture.user);
    const reason = await store.tx(fixture.tenant.id, (ops) =>
      ops.loginPrecheck({ userId: randomUUID(), deviceId: device.id }),
    );
    expect(reason).toBe("user_inactive");
  });

  it("refuses to resurrect a revoked install", async () => {
    const fixture = await seedFixture(store);
    const installId = randomUUID();
    const device = await addDevice(store, fixture, fixture.user, installId);
    await store.tx(fixture.tenant.id, (ops) => ops.devices.revoke(device.id, "admin"));

    const result = await store.tx(fixture.tenant.id, (ops) =>
      ops.devices.upsert({
        tenantId: fixture.tenant.id,
        orgId: fixture.org.id,
        userId: fixture.user.id,
        installId,
        platform: "windows",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("device_revoked");
  });
});
