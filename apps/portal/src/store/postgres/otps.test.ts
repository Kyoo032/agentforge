/**
 * OTP: 6 digits, 10-minute TTL, 5 attempts per code, single use, 3 sends per 15 minutes per
 * address, and 20 guesses per address per 24 hours.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomOtpCode } from "../../crypto";
import { seedFixture, type Fixture } from "../../testing/fixtures";
import { createTestStore, fixedClock, type TestStore } from "../../testing/pg";
import type { OtpPurpose, PortalStore } from "../types";

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

async function send(email: string, code: string, ttlMs?: number, purpose?: OtpPurpose) {
  return store.tx(fixture.tenant.id, (ops) =>
    ops.loginOtps.send({ tenantId: fixture.tenant.id, email, code, ttlMs, purpose }),
  );
}

async function verify(email: string, code: string, purpose?: OtpPurpose) {
  return store.tx(fixture.tenant.id, (ops) =>
    ops.loginOtps.verify({ tenantId: fixture.tenant.id, email, code, purpose }),
  );
}

/** Past the 15-minute send window, with room to spare for the real seconds a test takes. */
const PAST_SEND_WINDOW_MS = 16 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Spends an address's whole day: four codes with five wrong guesses each, so no code's own
 * five-attempt limit is what stops anything. Three sends fit in one 15-minute window, so the clock
 * moves before the fourth. `purposes` are used in turn, one per code.
 */
async function spendTheDay(email: string, purposes: readonly OtpPurpose[] = ["activate"]) {
  for (let n = 0; n < 4; n += 1) {
    if (n === 3) {
      clock.advance(PAST_SEND_WINDOW_MS);
    }
    const purpose = purposes[n % purposes.length];
    const code = String(n + 1).repeat(6);
    expect((await send(email, code, undefined, purpose)).ok).toBe(true);
    for (let guess = 1; guess <= 5; guess += 1) {
      const wrong = await verify(email, "999999", purpose);
      expect(wrong.ok, `code ${n + 1}, guess ${guess}`).toBe(false);
      if (wrong.ok) return;
      expect(wrong.reason).toBe("invalid_code");
    }
  }
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

/**
 * Five guesses a code and three codes per 15 minutes is 60 guesses an hour, about 1,440 a day, at
 * one address: roughly a 0.14% chance a day of guessing a six-digit code, forever. The daily total
 * caps that at 20 guesses, a 0.002% chance a day.
 */
describe("the daily guess budget", () => {
  it("refuses the right code on a fresh code once twenty guesses were spent inside 24 hours", async () => {
    clock.set(new Date());
    const email = address();
    await spendTheDay(email);

    // A fifth code, never guessed at, and the right one: the lock is on the address, not the code.
    const fresh = "555555";
    expect((await send(email, fresh)).ok).toBe(true);
    const refused = await verify(email, fresh);

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("locked");
    expect(refused.attemptsRemaining).toBe(0);

    // And it stays refused on the next try.
    const again = await verify(email, fresh);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("locked");
  });

  it("still checks the twentieth guess, and refuses the one after it", async () => {
    clock.set(new Date());
    const email = address();
    // 19 wrong guesses: three burned codes, then four on the fourth.
    for (let n = 0; n < 4; n += 1) {
      if (n === 3) {
        clock.advance(PAST_SEND_WINDOW_MS);
      }
      await send(email, String(n + 1).repeat(6));
      for (let guess = 0; guess < (n === 3 ? 4 : 5); guess += 1) {
        await verify(email, "999999");
      }
    }

    // The twentieth is checked like any other guess: a wrong code, not a lock.
    const twentieth = await verify(email, "999999");
    expect(twentieth.ok).toBe(false);
    if (twentieth.ok) return;
    expect(twentieth.reason).toBe("invalid_code");

    // The twenty-first is refused before it is compared, on a fresh code with the right digits.
    await send(email, "666666");
    const twentyFirst = await verify(email, "666666");
    expect(twentyFirst.ok).toBe(false);
    if (twentyFirst.ok) return;
    expect(twentyFirst.reason).toBe("locked");
  });

  it("counts guesses across both purposes, and only for that address", async () => {
    clock.set(new Date());
    const email = address();
    await spendTheDay(email, ["activate", "portal_login"]);

    await send(email, "777777", undefined, "portal_login");
    const refused = await verify(email, "777777", "portal_login");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("locked");

    const other = address();
    await send(other, "888888");
    expect((await verify(other, "888888")).ok).toBe(true);
  });

  /**
   * Two codes can be live at once, one per purpose, and each code's own row lock only serialises
   * guesses at THAT code. So the twentieth guess, still uncommitted, is held open here while a
   * guess at the other purpose's code arrives. The second has to wait for the first and then see
   * twenty. Reading the total without the address's rows locked, it would see the committed 19 and
   * be checked as a twenty-first guess.
   */
  it("counts a guess at the other purpose's code while the twentieth is still uncommitted", async () => {
    clock.set(new Date());
    const email = address();
    for (let n = 0; n < 3; n += 1) {
      await send(email, String(n + 1).repeat(6));
      for (let guess = 0; guess < 5; guess += 1) {
        await verify(email, "999999");
      }
    }
    clock.advance(PAST_SEND_WINDOW_MS);
    await send(email, "444444", undefined, "activate");
    for (let guess = 0; guess < 4; guess += 1) {
      await verify(email, "999999", "activate");
    }
    await send(email, "555555", undefined, "portal_login");

    let twentiethChecked!: () => void;
    const checked = new Promise<void>((resolve) => {
      twentiethChecked = resolve;
    });
    const twentieth = store.tx(fixture.tenant.id, async (ops) => {
      const result = await ops.loginOtps.verify({
        tenantId: fixture.tenant.id,
        email,
        code: "999999",
        purpose: "activate",
      });
      twentiethChecked();
      // Not committed yet: the next guess arrives inside this window.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return result;
    });
    await checked;
    const next = await verify(email, "999999", "portal_login");
    const first = await twentieth;

    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.reason).toBe("invalid_code");
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(next.reason).toBe("locked");
  });

  it("lifts once the guesses age out of the 24-hour window", async () => {
    clock.set(new Date());
    const email = address();
    await spendTheDay(email);

    clock.advance(DAY_MS);
    await send(email, "121212");
    expect((await verify(email, "121212")).ok).toBe(true);
  });
});
