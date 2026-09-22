/**
 * Refresh-token rotation, reuse detection and device binding — i.e. `rotate_refresh_token` as the
 * store calls it, which is the only thing standing between a stolen token and a silent shadow
 * session.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomToken } from "../../crypto";
import { addDevice, seedFixture, type Fixture } from "../../testing/fixtures";
import { createTestStore, type TestStore } from "../../testing/pg";
import type { Device, PortalStore, Session } from "../types";

let harness: TestStore;
let store: PortalStore;
let fixture: Fixture;

beforeAll(async () => {
  harness = await createTestStore();
  store = harness.store;
  fixture = await seedFixture(store);
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

interface Chain {
  readonly session: Session;
  readonly device: Device;
  readonly token: string;
}

async function newChain(ttlMs?: number): Promise<Chain> {
  const device = await addDevice(store, fixture, fixture.user, randomUUID());
  const token = randomToken();
  const session = await store.tx(fixture.tenant.id, async (ops) => {
    const created = await ops.sessions.create({
      tenantId: fixture.tenant.id,
      orgId: fixture.org.id,
      userId: fixture.user.id,
      deviceId: device.id,
    });
    await ops.refreshTokens.issue({ sessionId: created.id, rawToken: token, ttlMs });
    return created;
  });
  return { session, device, token };
}

describe("refresh rotation", () => {
  it("spends the presented token and issues the next generation", async () => {
    const chain = await newChain();
    const next = randomToken();

    const result = await store.rotateRefreshToken({
      presentedToken: chain.token,
      newToken: next,
      deviceId: chain.device.id,
    });

    expect(result.reason).toBe("ok");
    if (result.reason !== "ok") return;
    expect(result.generation).toBe(2);
    expect(result.sessionId).toBe(chain.session.id);
    expect(result.userId).toBe(fixture.user.id);

    const rows = await store.tx(fixture.tenant.id, (ops) =>
      ops.refreshTokens.listForSession(chain.session.id),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].usedAt).not.toBeNull();
    expect(rows[0].replacedBy).toBe(rows[1].id);
    expect(rows[1].usedAt).toBeNull();
  });

  it("rotates repeatedly, one generation at a time", async () => {
    const chain = await newChain();
    let current = chain.token;
    for (let generation = 2; generation <= 4; generation += 1) {
      const next = randomToken();
      const result = await store.rotateRefreshToken({
        presentedToken: current,
        newToken: next,
        deviceId: chain.device.id,
      });
      expect(result.reason).toBe("ok");
      if (result.reason !== "ok") return;
      expect(result.generation).toBe(generation);
      current = next;
    }
  });

  it("treats a replayed generation as reuse and kills the whole chain", async () => {
    const chain = await newChain();
    const second = randomToken();
    await store.rotateRefreshToken({
      presentedToken: chain.token,
      newToken: second,
      deviceId: chain.device.id,
    });

    // The thief presents the generation the legitimate client already spent.
    const replay = await store.rotateRefreshToken({
      presentedToken: chain.token,
      newToken: randomToken(),
      deviceId: chain.device.id,
    });
    expect(replay.reason).toBe("refresh_reused");

    const session = await store.tx(fixture.tenant.id, (ops) => ops.sessions.findById(chain.session.id));
    expect(session?.revokedAt).not.toBeNull();
    expect(session?.revokedReason).toBe("refresh_reused");

    // And the successor the honest client is holding is dead too.
    const afterKill = await store.rotateRefreshToken({
      presentedToken: second,
      newToken: randomToken(),
      deviceId: chain.device.id,
    });
    expect(afterKill.reason).toBe("refresh_reused");

    const rows = await store.tx(fixture.tenant.id, (ops) =>
      ops.refreshTokens.listForSession(chain.session.id),
    );
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("answers refresh_expired — never 'unknown' — for a token that was never issued", async () => {
    const result = await store.rotateRefreshToken({
      presentedToken: randomToken(),
      newToken: randomToken(),
    });
    expect(result.reason).toBe("refresh_expired");
    expect(result.sessionId).toBeNull();
  });

  it("answers refresh_expired for an aged-out token", async () => {
    const chain = await newChain(-1_000);
    const result = await store.rotateRefreshToken({
      presentedToken: chain.token,
      newToken: randomToken(),
      deviceId: chain.device.id,
    });
    expect(result.reason).toBe("refresh_expired");
  });

  it("treats a device mismatch as reuse, because the token left its device", async () => {
    const chain = await newChain();
    const otherDevice = await addDevice(store, fixture, fixture.user, randomUUID());

    const result = await store.rotateRefreshToken({
      presentedToken: chain.token,
      newToken: randomToken(),
      deviceId: otherDevice.id,
    });
    expect(result.reason).toBe("refresh_reused");

    const session = await store.tx(fixture.tenant.id, (ops) => ops.sessions.findById(chain.session.id));
    expect(session?.revokedAt).not.toBeNull();
  });

  it("caps the sliding TTL at the session's absolute expiry", async () => {
    const device = await addDevice(store, fixture, fixture.user, randomUUID());
    const token = randomToken();
    const { session, expiresAt } = await store.tx(fixture.tenant.id, async (ops) => {
      const created = await ops.sessions.create({
        tenantId: fixture.tenant.id,
        orgId: fixture.org.id,
        userId: fixture.user.id,
        deviceId: device.id,
        // A session with one day left cannot hand out a 30-day refresh token.
        absoluteTtlMs: 24 * 60 * 60 * 1000,
      });
      const issued = await ops.refreshTokens.issue({ sessionId: created.id, rawToken: token });
      return { session: created, expiresAt: issued.expiresAt };
    });

    expect(new Date(expiresAt).getTime()).toBeLessThanOrEqual(
      new Date(session.absoluteExpiresAt).getTime(),
    );

    const rotated = await store.rotateRefreshToken({
      presentedToken: token,
      newToken: randomToken(),
      deviceId: device.id,
    });
    expect(rotated.reason).toBe("ok");
    if (rotated.reason !== "ok") return;
    expect(new Date(rotated.expiresAt).getTime()).toBeLessThanOrEqual(
      new Date(session.absoluteExpiresAt).getTime(),
    );
  });

  it("refuses a refresh once the session has been revoked", async () => {
    const chain = await newChain();
    await store.tx(fixture.tenant.id, (ops) => ops.sessions.revoke(chain.session.id, "logout"));

    const result = await store.rotateRefreshToken({
      presentedToken: chain.token,
      newToken: randomToken(),
      deviceId: chain.device.id,
    });
    // revoke_session_chain revokes the outstanding rows, so the token reads as reuse rather than
    // as a live token under a dead session. Either way the client signs in again.
    expect(result.reason).toBe("refresh_reused");
  });

  it("refuses a refresh once the device has been revoked", async () => {
    const chain = await newChain();
    await store.tx(fixture.tenant.id, (ops) => ops.devices.revoke(chain.device.id, "admin"));

    const result = await store.rotateRefreshToken({
      presentedToken: chain.token,
      newToken: randomToken(),
      deviceId: chain.device.id,
    });
    expect(result.reason).toBe("device_revoked");
  });

  it("returns frozen rows", async () => {
    const chain = await newChain();
    const rows = await store.tx(fixture.tenant.id, (ops) =>
      ops.refreshTokens.listForSession(chain.session.id),
    );
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });
});
