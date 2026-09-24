/**
 * The session gate's question to the portal (./portal-check.ts).
 *
 * The host used to trust its own `auth_sessions` row for up to 12 h idle / 30 days, and nothing
 * called the portal after sign-in, so a session the portal revoked, a user it disabled or an
 * organisation that fell past due kept working here. The gate now rotates the refresh token once
 * the portal's last word is older than ten minutes and ends the session on a terminal answer.
 *
 * What this file pins, beyond "it asks":
 *   - an unanswered portal never ends a session, and the request never waits on it for long;
 *   - one refresh at a time per session, whoever asks — two rotations with one refresh token are
 *     exactly what the portal's reuse detection kills the whole chain for;
 *   - a refresh the request stopped waiting for still lands: the rotated token is kept, and a
 *     terminal answer still ends the session.
 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { log } from "../log";
import { PortalError, mapPortalError, type PortalClient, type PortalTokens } from "./portal-client";
import {
  PORTAL_CHECK_RETRY_MS,
  PORTAL_CHECK_WAIT_MS,
  TERMINAL_PORTAL_REASONS,
  createPortalSessionCheck,
} from "./portal-check";
import { PORTAL_CHECK_INTERVAL_MS, createSession, verifySession, type AuthReason, type SessionRecord } from "./session";
import { createSessionSecrets, type SessionSecrets } from "./session-secrets";
import { createMemorySessionStore, createMemoryTokenVault, type SessionStore, type TokenVault } from "./session-store";

const T0 = Date.UTC(2026, 8, 23, 9, 0, 0);
/** The wrap key the harness seals under, and one it does not. */
const WRAP = createHash("sha256").update("harness-wrap-key", "utf8").digest();
const OTHER_WRAP = createHash("sha256").update("a-different-wrap-key", "utf8").digest();
const DUE = T0 + PORTAL_CHECK_INTERVAL_MS;

function tokens(generation: number): PortalTokens {
  return {
    accessToken: `access-${generation}`,
    refreshToken: `refresh-${generation}`,
    expiresIn: 3600,
    refreshExpiresIn: 2592000,
    sessionId: "ses_portal",
    deviceId: "dev_1",
    userId: "usr_1",
    orgId: "org_1",
    tenantId: "tnt_1",
  };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A portal whose next refresh answer the test chooses. Records what it was asked, never a secret. */
function portalDouble() {
  const refreshCalls: Array<{ refreshToken: string; deviceId: string | null }> = [];
  let generation = 1;
  let answer: () => Promise<PortalTokens> = async () => tokens(++generation);
  const client: PortalClient = {
    async exchangeCode() {
      throw new Error("not used here");
    },
    async refresh({ refreshToken, deviceId }) {
      refreshCalls.push({ refreshToken, deviceId: deviceId ?? null });
      return answer();
    },
    async logout() {},
  };
  return {
    client,
    refreshCalls,
    answerWith(next: () => Promise<PortalTokens>) {
      answer = next;
    },
  };
}

type Harness = {
  store: SessionStore;
  vault: TokenVault;
  portal: ReturnType<typeof portalDouble>;
  session: SessionRecord;
  check: ReturnType<typeof createPortalSessionCheck>;
  secrets: SessionSecrets;
  clock: { now: number };
  context: { store: SessionStore; now: () => number };
};

async function harness(
  options: { withTokens?: boolean; waitMs?: number; secrets?: SessionSecrets } = {},
): Promise<Harness> {
  const store = createMemorySessionStore();
  const vault = createMemoryTokenVault();
  const portal = portalDouble();
  const session = createSession({ tenantId: "tnt_1", userId: "usr_1", orgId: "org_1", now: T0 });
  await store.create(session);
  if (options.withTokens ?? true) {
    await vault.put(session.id, { refreshToken: "refresh-1", accessToken: "access-1", deviceId: "dev_1" });
  }
  const clock = { now: DUE };
  const secrets = options.secrets ?? createSessionSecrets(() => WRAP);
  const check = createPortalSessionCheck({ vault, portal: portal.client, waitMs: options.waitMs, secrets });
  return { store, vault, portal, session, check, secrets, clock, context: { store, now: () => clock.now } };
}

/** What the next request's gate would read back from the store. */
async function reread(h: Harness): Promise<SessionRecord> {
  const found = await h.store.find(h.session.id);
  if (!found) {
    throw new Error("session row disappeared");
  }
  return found;
}

describe("the gate inside the interval", () => {
  it("does not ask the portal at all", async () => {
    const h = await harness();
    h.clock.now = DUE - 1;
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    expect(h.portal.refreshCalls).toEqual([]);
  });
});

describe("the gate once the portal's last word is ten minutes old", () => {
  it("rotates the refresh token, keeps the new pair and stamps the check", async () => {
    const h = await harness();
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    expect(h.portal.refreshCalls).toEqual([{ refreshToken: "refresh-1", deviceId: "dev_1" }]);
    // Persisted the way sign-in persists them: the vault, never the row.
    expect(await h.vault.get(h.session.id)).toEqual({
      refreshToken: "refresh-2",
      accessToken: "access-2",
      deviceId: "dev_1",
    });
    expect((await reread(h)).portalCheckedAt).toBe(DUE);
    expect((await reread(h)).revokedAt).toBeNull();
  });

  it("keeps the device id it holds when a rotation answer leaves it out", async () => {
    const h = await harness();
    h.portal.answerWith(async () => ({ ...tokens(2), deviceId: null }));
    await h.check.gate(h.session, h.context);
    expect(await h.vault.get(h.session.id)).toEqual({
      refreshToken: "refresh-2",
      accessToken: "access-2",
      deviceId: "dev_1",
    });
  });

  it("uses the rotated token the next time, not the spent one", async () => {
    const h = await harness();
    await h.check.gate(h.session, h.context);
    h.clock.now = DUE + PORTAL_CHECK_INTERVAL_MS;
    await h.check.gate(await reread(h), h.context);
    expect(h.portal.refreshCalls.map((call) => call.refreshToken)).toEqual(["refresh-1", "refresh-2"]);
  });

  it("knows every reason that ends a session", () => {
    expect([...TERMINAL_PORTAL_REASONS].sort()).toEqual(
      [
        "device_revoked",
        "invalid_grant",
        "org_inactive",
        "org_past_due",
        "refresh_expired",
        "refresh_reused",
        "seat_cap_reached",
        "session_revoked",
        "tenant_inactive",
        "user_inactive",
      ].sort(),
    );
  });

  it.each([...TERMINAL_PORTAL_REASONS])("ends the session here when the portal answers %s", async (reason) => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new PortalError(reason as AuthReason, 401, { messageEn: "Portal copy." });
    });
    const verdict = await h.check.gate(h.session, h.context);
    expect(verdict).toEqual({ ok: false, reason, message: "Portal copy." });
    expect((await reread(h)).revokedAt).toBe(DUE);
    expect(await h.vault.get(h.session.id)).toBeNull();
    expect(verifySession(await reread(h), DUE)).toEqual({ ok: false, reason: "session_revoked" });
  });

  it("falls back to no message when the portal sent no copy", async () => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new PortalError("device_revoked", 403);
    });
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: false, reason: "device_revoked", message: null });
  });

  it("ends the session when there is nothing to present, which is what a server restart leaves", async () => {
    const h = await harness({ withTokens: false });
    expect(await h.check.gate(h.session, h.context)).toEqual({
      ok: false,
      reason: "refresh_expired",
      message: null,
    });
    expect(h.portal.refreshCalls).toEqual([]);
    expect((await reread(h)).revokedAt).toBe(DUE);
  });

  it("never puts a token in its verdict", async () => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new PortalError("session_revoked", 401);
    });
    const verdict = await h.check.gate(h.session, h.context);
    expect(JSON.stringify(verdict)).not.toMatch(/refresh-|access-/);
  });
});

describe("a portal that does not answer", () => {
  it.each([
    ["unreachable", new PortalError("portal_unavailable", 503)],
    ["rate-limiting the host", new PortalError("invalid_request", 429, { retryAfter: 30 })],
    ["answering a malformed request", new PortalError("invalid_request", 400)],
  ])("keeps the session when the portal is %s", async (_name, refusal) => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw refusal;
    });
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    const after = await reread(h);
    expect(after.revokedAt).toBeNull();
    // Not stamped: the portal said nothing about this session, so the check is still owed.
    expect(after.portalCheckedAt).toBe(T0);
    expect(await h.vault.get(h.session.id)).toMatchObject({ refreshToken: "refresh-1" });
  });

  it("keeps the session when the portal client cannot even be built", async () => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new Error("AGENTFORGE_PORTAL_URL is not set; the hosted server cannot reach the portal.");
    });
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    expect((await reread(h)).revokedAt).toBeNull();
  });

  it("does not ask again for a minute, so an outage does not slow every request", async () => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new PortalError("portal_unavailable", 503);
    });
    await h.check.gate(h.session, h.context);
    h.clock.now = DUE + PORTAL_CHECK_RETRY_MS - 1;
    await h.check.gate(h.session, h.context);
    expect(h.portal.refreshCalls).toHaveLength(1);
    h.clock.now = DUE + PORTAL_CHECK_RETRY_MS;
    await h.check.gate(h.session, h.context);
    expect(h.portal.refreshCalls).toHaveLength(2);
  });

  it("honours a longer retry_after from a rate-limited portal", async () => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new PortalError("invalid_request", 429, { retryAfter: 300 });
    });
    await h.check.gate(h.session, h.context);
    h.clock.now = DUE + PORTAL_CHECK_RETRY_MS;
    await h.check.gate(h.session, h.context);
    expect(h.portal.refreshCalls).toHaveLength(1);
    h.clock.now = DUE + 300_000;
    await h.check.gate(h.session, h.context);
    expect(h.portal.refreshCalls).toHaveLength(2);
  });

  it("asks again at once after a successful check clears the back-off", async () => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new PortalError("portal_unavailable", 503);
    });
    await h.check.gate(h.session, h.context);
    h.portal.answerWith(async () => tokens(7));
    h.clock.now = DUE + PORTAL_CHECK_RETRY_MS;
    await h.check.gate(h.session, h.context);
    expect((await reread(h)).portalCheckedAt).toBe(DUE + PORTAL_CHECK_RETRY_MS);
  });
});

describe("one refresh at a time per session", () => {
  it("lets five concurrent requests share one rotation", async () => {
    const h = await harness();
    const answer = deferred<PortalTokens>();
    h.portal.answerWith(() => answer.promise);
    const verdicts = Promise.all(Array.from({ length: 5 }, () => h.check.gate(h.session, h.context)));
    answer.resolve(tokens(2));
    expect(await verdicts).toEqual(Array.from({ length: 5 }, () => ({ ok: true })));
    expect(h.portal.refreshCalls).toHaveLength(1);
  });

  it("shares it between the gate and a sign-out's refresh too", async () => {
    const h = await harness();
    const answer = deferred<PortalTokens>();
    h.portal.answerWith(() => answer.promise);
    const gate = h.check.gate(h.session, h.context);
    const signOut = h.check.refresh(h.session, h.context);
    answer.resolve(tokens(2));
    expect(await gate).toEqual({ ok: true });
    expect(await signOut).toMatchObject({ kind: "rotated", tokens: { accessToken: "access-2" } });
    expect(h.portal.refreshCalls).toHaveLength(1);
  });

  it("hands every waiter the same terminal answer", async () => {
    const h = await harness();
    const answer = deferred<PortalTokens>();
    h.portal.answerWith(() => answer.promise);
    const verdicts = Promise.all([h.check.gate(h.session, h.context), h.check.gate(h.session, h.context)]);
    answer.reject(new PortalError("user_inactive", 403));
    expect(await verdicts).toEqual([
      { ok: false, reason: "user_inactive", message: null },
      { ok: false, reason: "user_inactive", message: null },
    ]);
    expect(h.portal.refreshCalls).toHaveLength(1);
  });

  it("does not hold one session's check behind another's", async () => {
    const h = await harness();
    const other = createSession({ tenantId: "tnt_2", userId: "usr_2", orgId: "org_2", now: T0 });
    await h.store.create(other);
    await h.vault.put(other.id, { refreshToken: "other-1", accessToken: "other-a", deviceId: null });
    await Promise.all([h.check.gate(h.session, h.context), h.check.gate(other, h.context)]);
    expect(h.portal.refreshCalls.map((call) => call.refreshToken).sort()).toEqual(["other-1", "refresh-1"]);
  });
});

describe("when the host's own storage fails", () => {
  it("still refuses the request when the revocation cannot be written, and drops the tokens", async () => {
    const h = await harness();
    h.portal.answerWith(async () => {
      throw new PortalError("device_revoked", 403);
    });
    const failing: SessionStore = {
      ...h.store,
      async save() {
        throw new Error("database is locked");
      },
    };
    const verdict = await h.check.gate(h.session, { store: failing, now: () => h.clock.now });
    expect(verdict).toEqual({ ok: false, reason: "device_revoked", message: null });
    expect(await h.vault.get(h.session.id)).toBeNull();
  });

  it("keeps the rotated pair when the check stamp cannot be written", async () => {
    const h = await harness();
    const failing: SessionStore = {
      ...h.store,
      async recordRotation() {
        throw new Error("database is locked");
      },
    };
    expect(await h.check.gate(h.session, { store: failing, now: () => h.clock.now })).toEqual({ ok: true });
    expect((await h.vault.get(h.session.id))?.refreshToken).toBe("refresh-2");
  });

  it("reads a vault that throws as no answer, never as a sign-out, and does not stay stuck", async () => {
    const h = await harness();
    let broken = true;
    const vault: TokenVault = {
      ...h.vault,
      async get(sessionId) {
        if (broken) {
          throw new Error("vault unavailable");
        }
        return h.vault.get(sessionId);
      },
    };
    const check = createPortalSessionCheck({ vault, portal: h.portal.client, secrets: h.secrets });
    expect(await check.gate(h.session, h.context)).toEqual({ ok: true });
    expect((await reread(h)).revokedAt).toBeNull();
    broken = false;
    h.clock.now = DUE + PORTAL_CHECK_RETRY_MS;
    expect(await check.refresh(h.session, h.context)).toMatchObject({ kind: "rotated" });
  });
});

describe("a slow portal", () => {
  it("waits a few seconds at most by default", () => {
    expect(PORTAL_CHECK_WAIT_MS).toBeGreaterThan(0);
    expect(PORTAL_CHECK_WAIT_MS).toBeLessThanOrEqual(3000);
  });

  it("lets the request through after the wait, and still keeps the rotated token when it lands", async () => {
    const h = await harness({ waitMs: 10 });
    const answer = deferred<PortalTokens>();
    h.portal.answerWith(() => answer.promise);
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    // The portal has spent refresh-1 by now. Dropping its answer would make the next check a
    // replay, which the portal reads as theft and answers by ending the session.
    answer.resolve(tokens(2));
    await h.check.refresh(h.session, h.context).catch(() => undefined);
    expect((await h.vault.get(h.session.id))?.refreshToken).not.toBe("refresh-1");
    expect(h.portal.refreshCalls[0]).toEqual({ refreshToken: "refresh-1", deviceId: "dev_1" });
  });

  it("still ends the session when the late answer is terminal", async () => {
    const h = await harness({ waitMs: 10 });
    const answer = deferred<PortalTokens>();
    h.portal.answerWith(() => answer.promise);
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    answer.reject(new PortalError("device_revoked", 403));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await reread(h)).revokedAt).toBe(DUE);
    expect(await h.vault.get(h.session.id)).toBeNull();
  });
});

/**
 * Owner decision, 2026-09-23: a restart or a deploy signs nobody out. The vault above is process
 * memory; the refresh token is ALSO kept sealed on the session row, and after a restart the first
 * portal check opens it and refreshes as if nothing happened.
 */
describe("a restart signs nobody out", () => {
  /** A signed-in session as a fresh process finds it: a sealed token on the row, nothing in memory. */
  async function afterRestart(sealedWith: Buffer = WRAP) {
    const h = await harness({ withTokens: false });
    const sealed = createSessionSecrets(() => sealedWith).seal(h.session.id, {
      refreshToken: "refresh-1",
      deviceId: "dev_1",
    });
    await h.store.create(h.session, sealed);
    return h;
  }

  it("opens the sealed token, refreshes with it, and keeps the session", async () => {
    const h = await afterRestart();
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    expect(h.portal.refreshCalls).toEqual([{ refreshToken: "refresh-1", deviceId: "dev_1" }]);
    expect(await h.vault.get(h.session.id)).toEqual({
      refreshToken: "refresh-2",
      accessToken: "access-2",
      deviceId: "dev_1",
    });
    expect((await reread(h)).revokedAt).toBeNull();
  });

  it("writes the rotated token back sealed, in the same write as the check stamp", async () => {
    const h = await afterRestart();
    await h.check.gate(h.session, h.context);
    const stored = (await h.store.readRefreshSealed(h.session.id)) as string;
    expect(stored).not.toContain("refresh-2");
    expect(h.secrets.open(h.session.id, stored)).toEqual({ refreshToken: "refresh-2", deviceId: "dev_1" });
    expect((await reread(h)).portalCheckedAt).toBe(DUE);
  });

  it("survives a second restart too: the next process reads the token the last rotation stored", async () => {
    const first = await afterRestart();
    await first.check.gate(first.session, first.context);
    const second = createPortalSessionCheck({
      vault: createMemoryTokenVault(),
      portal: first.portal.client,
      secrets: first.secrets,
    });
    first.clock.now = DUE + PORTAL_CHECK_INTERVAL_MS;
    expect(await second.gate(await reread(first), first.context)).toEqual({ ok: true });
    expect(first.portal.refreshCalls.map((call) => call.refreshToken)).toEqual(["refresh-1", "refresh-2"]);
  });

  it("serves a /auth/refresh or a sign-out the same way, since they share the path", async () => {
    const h = await afterRestart();
    h.clock.now = T0 + 60_000;
    expect(await h.check.refresh(h.session, h.context)).toMatchObject({
      kind: "rotated",
      tokens: { accessToken: "access-2" },
    });
  });

  it("ends the session cleanly when the sealed token does not open, which a wrap key changed without the drill leaves", async () => {
    const h = await afterRestart(OTHER_WRAP);
    const warn = vi.spyOn(log, "warn");
    const verdict = await h.check.gate(h.session, h.context);
    expect(verdict).toEqual({ ok: false, reason: "refresh_expired", message: null });
    expect(h.portal.refreshCalls).toEqual([]);
    expect((await reread(h)).revokedAt).toBe(DUE);
    expect(await h.store.readRefreshSealed(h.session.id)).toBeNull();
    const line = warn.mock.calls.find(([event]) => event === "portal_session_ended");
    expect(line?.[1]).toMatchObject({ code: "refresh_expired", cause: "unreadable" });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/refresh-1/);
    warn.mockRestore();
  });

  it("does not end anybody when the wrap key itself cannot be read: that is the deployment, not the session", async () => {
    const h = await afterRestart();
    const broken = createPortalSessionCheck({
      vault: createMemoryTokenVault(),
      portal: h.portal.client,
      secrets: createSessionSecrets(() => {
        throw new Error("AGENTFORGE_SECRETS_KEY is required in server mode");
      }),
    });
    expect(await broken.gate(h.session, h.context)).toEqual({ ok: true });
    expect((await reread(h)).revokedAt).toBeNull();
    expect(await h.store.readRefreshSealed(h.session.id)).not.toBeNull();
  });

  it("clears the stored token when the rotated one cannot be sealed, rather than leave the spent one", async () => {
    const h = await afterRestart();
    const unsealable: SessionSecrets = {
      open: (id, sealed) => h.secrets.open(id, sealed),
      seal: () => {
        throw new Error("AGENTFORGE_SECRETS_KEY is required in server mode");
      },
    };
    const check = createPortalSessionCheck({
      vault: createMemoryTokenVault(),
      portal: h.portal.client,
      secrets: unsealable,
    });
    expect(await check.gate(h.session, h.context)).toEqual({ ok: true });
    // refresh-1 is spent at the portal: presenting it after a restart would read as token theft.
    expect(await h.store.readRefreshSealed(h.session.id)).toBeNull();
    expect((await reread(h)).portalCheckedAt).toBe(DUE);
  });

  it("drops the stored token with the session when the portal ends it", async () => {
    const h = await afterRestart();
    h.portal.answerWith(async () => {
      throw new PortalError("device_revoked", 403);
    });
    expect(await h.check.gate(h.session, h.context)).toMatchObject({ ok: false, reason: "device_revoked" });
    expect(await h.store.readRefreshSealed(h.session.id)).toBeNull();
  });

  it("keeps the stored token when the portal does not answer, so the next check can try again", async () => {
    const h = await afterRestart();
    const before = await h.store.readRefreshSealed(h.session.id);
    h.portal.answerWith(async () => {
      throw new PortalError("portal_unavailable", 503);
    });
    expect(await h.check.gate(h.session, h.context)).toEqual({ ok: true });
    expect(await h.store.readRefreshSealed(h.session.id)).toBe(before);
  });
});

/**
 * Every refresh the check makes — the gate's, `/auth/refresh`'s, a sign-out's — authenticates as
 * the deployment's confidential client, so the portal counts the host's traffic against the client
 * (20,000 / 10 min) and not against the one address every hosted session refreshes from.
 */
describe("the check refreshes as the confidential client", () => {
  function capturingPortal(answer: () => Promise<PortalTokens> = async () => tokens(2)) {
    const seen: Array<Record<string, unknown>> = [];
    const client: PortalClient = {
      async exchangeCode() {
        throw new Error("not used here");
      },
      async refresh(input) {
        seen.push({ ...input });
        return answer();
      },
      async logout() {},
    };
    return { client, seen };
  }

  it("presents the configured client id and secret on the refresh", async () => {
    const h = await harness();
    const portal = capturingPortal();
    const check = createPortalSessionCheck({
      vault: h.vault,
      portal: portal.client,
      secrets: h.secrets,
      clientCredentials: () => ({ clientId: "cli_abc", clientSecret: "sec_xyz" }),
    });
    expect(await check.gate(h.session, h.context)).toEqual({ ok: true });
    expect(portal.seen).toEqual([
      { refreshToken: "refresh-1", deviceId: "dev_1", clientId: "cli_abc", clientSecret: "sec_xyz" },
    ]);
  });

  it("refreshes without them when the deployment has none configured", async () => {
    const h = await harness();
    const portal = capturingPortal();
    const check = createPortalSessionCheck({ vault: h.vault, portal: portal.client, secrets: h.secrets });
    await check.gate(h.session, h.context);
    expect(portal.seen[0]).not.toHaveProperty("clientSecret");
  });

  it("keeps every session when the portal rejects the deployment's own client, and says so without the secret", async () => {
    const h = await harness();
    const portal = capturingPortal(async () => {
      throw mapPortalError(401, {
        error: "invalid_client",
        reason: "invalid_grant",
        message_en: "Client authentication failed.",
      });
    });
    const error = vi.spyOn(log, "error");
    const check = createPortalSessionCheck({
      vault: h.vault,
      portal: portal.client,
      secrets: h.secrets,
      clientCredentials: () => ({ clientId: "cli_abc", clientSecret: "sec_wrong" }),
    });
    expect(await check.gate(h.session, h.context)).toEqual({ ok: true });
    expect((await reread(h)).revokedAt).toBeNull();
    const line = error.mock.calls.find(([event]) => event === "portal_client_rejected");
    expect(line?.[1]).toMatchObject({ rfcError: "invalid_client" });
    expect(JSON.stringify(error.mock.calls)).not.toContain("sec_wrong");
    error.mockRestore();
  });

  it("treats a credentials source that throws as none, rather than failing the check", async () => {
    const h = await harness();
    const portal = capturingPortal();
    const check = createPortalSessionCheck({
      vault: h.vault,
      portal: portal.client,
      secrets: h.secrets,
      clientCredentials: () => {
        throw new Error("login_not_configured");
      },
    });
    expect(await check.gate(h.session, h.context)).toEqual({ ok: true });
    expect(portal.seen).toHaveLength(1);
    expect(portal.seen[0]).not.toHaveProperty("clientSecret");
  });
});

/**
 * A failed drizzle query puts its bound parameters in its message (`Failed query: … params: …`),
 * and the rotation's write binds the sealed token. So a storage failure is logged by name and
 * SQLite code, never by message.
 */
describe("logging a storage failure", () => {
  class FakeDrizzleQueryError extends Error {
    readonly params: unknown[];
    readonly cause: unknown;
    constructor(params: unknown[]) {
      super(`Failed query: update "auth_sessions" set ...\nparams: ${params.join(",")}`);
      this.name = "DrizzleQueryError";
      this.params = params;
      this.cause = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    }
  }

  it("names the failed write and its SQLite code, never the parameters it carried", async () => {
    const h = await harness();
    const error = vi.spyOn(log, "error");
    const failing: SessionStore = {
      ...h.store,
      async recordRotation(_id, _at, sealed) {
        throw new FakeDrizzleQueryError([sealed, "the-row-digest"]);
      },
    };
    expect(await h.check.gate(h.session, { store: failing, now: () => h.clock.now })).toEqual({ ok: true });
    const line = error.mock.calls.find(([event]) => event === "portal_check_not_recorded");
    expect(line?.[1]).toMatchObject({ fault: { name: "DrizzleQueryError", code: "SQLITE_BUSY" } });
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("the-row-digest");
    expect(logged).not.toContain("Failed query");
    error.mockRestore();
  });

  it("still quotes an error that carries no parameters, such as a missing wrap key", async () => {
    const h = await harness({ withTokens: false });
    await h.store.create(h.session, h.secrets.seal(h.session.id, { refreshToken: "refresh-1", deviceId: "dev_1" }));
    const error = vi.spyOn(log, "error");
    const check = createPortalSessionCheck({
      vault: createMemoryTokenVault(),
      portal: h.portal.client,
      secrets: createSessionSecrets(() => {
        throw new Error("AGENTFORGE_SECRETS_KEY is required in server mode");
      }),
    });
    await check.gate(h.session, h.context);
    const line = error.mock.calls.find(([event]) => event === "portal_check_failed");
    expect(line?.[1]).toMatchObject({
      fault: { name: "Error", detail: "AGENTFORGE_SECRETS_KEY is required in server mode" },
    });
    error.mockRestore();
  });
});
