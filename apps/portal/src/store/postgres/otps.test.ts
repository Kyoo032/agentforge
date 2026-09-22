/** OTP: 6 digits, 10-minute TTL, 5 attempts, single use, 3 sends per 15 minutes per address. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomOtpCode } from "../../crypto";
import { seedFixture, type Fixture } from "../../testing/fixtures";
import { createTestStore, fixedClock, type TestStore } from "../../testing/pg";
import type { PortalStore } from "../types";

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

function address(): string {
  return `user-${randomUUID().slice(0, 8)}@example.test`;
}

async function send(email: string, code: string, ttlMs?: number) {
  return store.tx(fixture.tenant.id, (ops) =>
    ops.loginOtps.send({ tenantId: fixture.tenant.id, email, code, ttlMs }),
  );
}

async function verify(email: string, code: string) {
  return store.tx(fixture.tenant.id, (ops) =>
    ops.loginOtps.verify({ tenantId: fixture.tenant.id, email, code }),
  );
}

describe("login OTPs", () => {
  it("verifies the right code once and refuses it afterwards", async () => {
    clock.set(new Date());
    const email = address();
    const code = randomOtpCode();
    const sent = await send(email, code);
    expect(sent.ok).toBe(true);

    const first = await verify(email, code);
    expect(first.ok).toBe(true);

    // Single use: consumed_at was set in the same transaction that verified it.
    const second = await verify(email, code);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("no_code");
  });

  it("never stores the code itself", async () => {
    clock.set(new Date());
    const email = address();
    const code = "424242";
    const sent = await send(email, code);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(JSON.stringify(sent.otp)).not.toContain(code);
    expect(Object.keys(sent.otp)).not.toContain("otpHash");
  });

  it("burns the code after five wrong guesses", async () => {
    clock.set(new Date());
    const email = address();
    const code = "111111";
    await send(email, code);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await verify(email, "999999");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("invalid_code");
      expect(result.attemptsRemaining).toBe(5 - attempt);
    }

    // A sixth verify can never succeed, not even with the right code.
    const sixth = await verify(email, code);
    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.reason).toBe("too_many_attempts");
  });

  it("expires after ten minutes", async () => {
    clock.set(new Date());
    const email = address();
    const code = randomOtpCode();
    await send(email, code, -1_000);
    const result = await verify(email, code);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("expired");
  });

  it("allows three sends per 15 minutes per address and refuses the fourth", async () => {
    clock.set(new Date());
    const email = address();
    for (let i = 0; i < 3; i += 1) {
      const sent = await send(email, randomOtpCode());
      expect(sent.ok).toBe(true);
      clock.advance(1_000);
    }

    const fourth = await send(email, randomOtpCode());
    expect(fourth.ok).toBe(false);
    if (fourth.ok) return;
    expect(fourth.reason).toBe("send_rate_limited");
    expect(fourth.retryAfter).toBeGreaterThan(0);
    expect(fourth.retryAfter).toBeLessThanOrEqual(15 * 60);
  });

  it("counts the send window from the rows, so a budget frees up as they age out", async () => {
    clock.set(new Date());
    const email = address();
    for (let i = 0; i < 3; i += 1) {
      await send(email, randomOtpCode());
      clock.advance(1_000);
    }
    expect((await send(email, randomOtpCode())).ok).toBe(false);

    clock.advance(15 * 60 * 1000);
    expect((await send(email, randomOtpCode())).ok).toBe(true);
  });

  it("scopes the send limit to one address", async () => {
    clock.set(new Date());
    const busy = address();
    for (let i = 0; i < 3; i += 1) {
      await send(busy, randomOtpCode());
    }
    expect((await send(busy, randomOtpCode())).ok).toBe(false);
    expect((await send(address(), randomOtpCode())).ok).toBe(true);
  });

  it("verifies the newest live code, so a re-send retires the previous one", async () => {
    clock.set(new Date());
    const email = address();
    const first = "222222";
    const second = "333333";
    await send(email, first);
    clock.advance(1_000);
    await send(email, second);

    const stale = await verify(email, first);
    expect(stale.ok).toBe(false);

    const fresh = await verify(email, second);
    expect(fresh.ok).toBe(true);
  });

  it("answers no_code for an address that was never sent one", async () => {
    const result = await verify(address(), "123456");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("no_code");
  });

  it("compares addresses case-insensitively, as citext does", async () => {
    clock.set(new Date());
    const email = address();
    const code = randomOtpCode();
    await send(email.toUpperCase(), code);
    const result = await verify(email, code);
    expect(result.ok).toBe(true);
  });
});
