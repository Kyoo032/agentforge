import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_LIFETIME_MS,
  AUTH_REASONS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  SESSION_COOKIE_SECURE,
  SLIDE_INTERVAL_MS,
  PORTAL_CHECK_INTERVAL_MS,
  createSession,
  hashSessionId,
  mintSessionId,
  portalCheckDue,
  readSessionCookie,
  revokedSession,
  sessionCookieMaxAge,
  sessionCookieName,
  sessionSummary,
  verifySession,
} from "./session";

const T0 = Date.UTC(2026, 8, 18, 9, 0, 0);
/** The hosted HTTPS server and everything else (webdev, the desktop), as the cookie sees them. */
const HOSTED = { secure: true } as const;
const LOCAL = { secure: false } as const;
const WHO = { tenantId: "tnt_1", userId: "usr_1", orgId: "org_1" } as const;

describe("mintSessionId", () => {
  it("is 32 random bytes in base64url", () => {
    const id = mintSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(id, "base64url")).toHaveLength(32);
  });

  it("never repeats", () => {
    const ids = new Set(Array.from({ length: 128 }, () => mintSessionId()));
    expect(ids.size).toBe(128);
  });
});

describe("createSession", () => {
  it("carries the portal identity and both expiries", () => {
    const session = createSession({ ...WHO, now: T0 });
    expect(session.tenantId).toBe("tnt_1");
    expect(session.userId).toBe("usr_1");
    expect(session.orgId).toBe("org_1");
    expect(session.createdAt).toBe(T0);
    expect(session.lastSeenAt).toBe(T0);
    expect(session.expiresAt).toBe(T0 + IDLE_TIMEOUT_MS);
    expect(session.absoluteExpiresAt).toBe(T0 + ABSOLUTE_LIFETIME_MS);
    expect(session.revokedAt).toBeNull();
    // The portal vouched for this person a moment ago: that is what signing in was.
    expect(session.portalCheckedAt).toBe(T0);
  });

  it("uses the spec's 12 hour idle and 30 day absolute windows", () => {
    expect(IDLE_TIMEOUT_MS).toBe(12 * 60 * 60 * 1000);
    expect(ABSOLUTE_LIFETIME_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(SLIDE_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("mints a fresh opaque id per session", () => {
    const a = createSession({ ...WHO, now: T0 });
    const b = createSession({ ...WHO, now: T0 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("verifySession", () => {
  it("refuses a missing session with session_required", () => {
    expect(verifySession(null, T0)).toEqual({ ok: false, reason: "session_required" });
    expect(verifySession(undefined, T0)).toEqual({ ok: false, reason: "session_required" });
  });

  it("refuses a revoked session with the portal's session_revoked", () => {
    const session = revokedSession(createSession({ ...WHO, now: T0 }), T0 + 1000);
    const verdict = verifySession(session, T0 + 2000);
    expect(verdict).toEqual({ ok: false, reason: "session_revoked" });
  });

  it("refuses an idle-expired session with refresh_expired", () => {
    const session = createSession({ ...WHO, now: T0 });
    expect(verifySession(session, T0 + IDLE_TIMEOUT_MS + 1)).toEqual({ ok: false, reason: "refresh_expired" });
  });

  it("refuses a session past its absolute expiry even when it was just seen", () => {
    const fresh = createSession({ ...WHO, now: T0 });
    const stretched = { ...fresh, lastSeenAt: T0 + ABSOLUTE_LIFETIME_MS, expiresAt: T0 + ABSOLUTE_LIFETIME_MS * 2 };
    expect(verifySession(stretched, T0 + ABSOLUTE_LIFETIME_MS + 1)).toEqual({
      ok: false,
      reason: "refresh_expired",
    });
  });

  it("accepts a live session without sliding inside the 5 minute window", () => {
    const session = createSession({ ...WHO, now: T0 });
    const verdict = verifySession(session, T0 + SLIDE_INTERVAL_MS - 1);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.slid).toBe(false);
    expect(verdict.session).toEqual(session);
  });

  it("slides lastSeenAt and the idle expiry once the window has passed", () => {
    const session = createSession({ ...WHO, now: T0 });
    const at = T0 + SLIDE_INTERVAL_MS;
    const verdict = verifySession(session, at);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.slid).toBe(true);
    expect(verdict.session.lastSeenAt).toBe(at);
    expect(verdict.session.expiresAt).toBe(at + IDLE_TIMEOUT_MS);
    // The stored record is never mutated in place.
    expect(session.lastSeenAt).toBe(T0);
    expect(session.expiresAt).toBe(T0 + IDLE_TIMEOUT_MS);
  });

  it("never slides the idle expiry past the absolute expiry", () => {
    const session = createSession({ ...WHO, now: T0 });
    const at = T0 + ABSOLUTE_LIFETIME_MS - 60_000;
    const verdict = verifySession({ ...session, lastSeenAt: at - SLIDE_INTERVAL_MS, expiresAt: at + 1000 }, at);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) {
      return;
    }
    expect(verdict.session.expiresAt).toBe(session.absoluteExpiresAt);
  });
});

describe("hashSessionId", () => {
  it("is SHA-256 in lowercase hex, which is what auth_sessions.id holds", () => {
    const id = mintSessionId();
    const digest = hashSessionId(id);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe(createHash("sha256").update(id, "utf8").digest("hex"));
  });

  it("is never the id itself, and never the same for two ids", () => {
    const a = mintSessionId();
    const b = mintSessionId();
    expect(hashSessionId(a)).not.toBe(a);
    expect(hashSessionId(a)).not.toBe(hashSessionId(b));
    expect(hashSessionId(a)).toBe(hashSessionId(a));
  });
});

describe("portalCheckDue", () => {
  it("is ten minutes", () => {
    expect(PORTAL_CHECK_INTERVAL_MS).toBe(10 * 60 * 1000);
  });

  it("is not due for a session the portal just vouched for", () => {
    const session = createSession({ ...WHO, now: T0 });
    expect(portalCheckDue(session, T0)).toBe(false);
    expect(portalCheckDue(session, T0 + PORTAL_CHECK_INTERVAL_MS - 1)).toBe(false);
  });

  it("is due once the interval has passed", () => {
    const session = createSession({ ...WHO, now: T0 });
    expect(portalCheckDue(session, T0 + PORTAL_CHECK_INTERVAL_MS)).toBe(true);
  });

  it("is due at once for a session that was never checked", () => {
    const session = { ...createSession({ ...WHO, now: T0 }), portalCheckedAt: null };
    expect(portalCheckDue(session, T0)).toBe(true);
  });
});

describe("revokedSession", () => {
  it("returns a revoked copy and leaves the original alone", () => {
    const session = createSession({ ...WHO, now: T0 });
    const revoked = revokedSession(session, T0 + 5);
    expect(revoked.revokedAt).toBe(T0 + 5);
    expect(session.revokedAt).toBeNull();
  });

  it("keeps the first revocation time when revoked twice", () => {
    const session = revokedSession(createSession({ ...WHO, now: T0 }), T0 + 5);
    expect(revokedSession(session, T0 + 50).revokedAt).toBe(T0 + 5);
  });
});

describe("sessionCookieMaxAge", () => {
  it("never outlives the absolute expiry", () => {
    const session = createSession({ ...WHO, now: T0 });
    expect(sessionCookieMaxAge(session, T0)).toBe(ABSOLUTE_LIFETIME_MS / 1000);
    expect(sessionCookieMaxAge(session, T0 + ABSOLUTE_LIFETIME_MS + 5000)).toBe(0);
  });
});

describe("sessionCookieName", () => {
  it("uses the __Host- prefixed name on the hosted server and the plain one off it", () => {
    expect(sessionCookieName(HOSTED)).toBe(SESSION_COOKIE_SECURE);
    expect(sessionCookieName(LOCAL)).toBe(SESSION_COOKIE);
    expect(SESSION_COOKIE_SECURE).toBe("__Host-agentforge_session");
    expect(SESSION_COOKIE).toBe("agentforge_session");
  });

  /**
   * The whole point of the prefix: a browser refuses a `__Host-` cookie that is not `Secure`,
   * `Path=/` and domain-less, and — the part that matters here — script or a sibling host on a
   * related domain cannot write one. Reading the plain name too would give that guarantee straight
   * back, so each mode reads exactly its own name and ignores the other.
   */
  it("reads only its own mode's cookie, so a plain-named one cannot fix a hosted session", () => {
    expect(readSessionCookie(`${SESSION_COOKIE_SECURE}=abc123`, HOSTED)).toBe("abc123");
    expect(readSessionCookie(`${SESSION_COOKIE}=attacker`, HOSTED)).toBeNull();
    expect(readSessionCookie(`${SESSION_COOKIE}=attacker; ${SESSION_COOKIE_SECURE}=abc123`, HOSTED)).toBe("abc123");
    expect(readSessionCookie(`${SESSION_COOKIE_SECURE}=abc123`, LOCAL)).toBeNull();
  });
});

describe("readSessionCookie", () => {
  it("reads the session id out of a cookie header", () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=abc123`, LOCAL)).toBe("abc123");
    expect(readSessionCookie(`agentforge_workspace=w1; ${SESSION_COOKIE}=abc123; other=x`, LOCAL)).toBe("abc123");
  });

  it("decodes the value", () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=a%20b`, LOCAL)).toBe("a b");
  });

  it("is null for a missing, empty or malformed header", () => {
    expect(readSessionCookie(undefined, LOCAL)).toBeNull();
    expect(readSessionCookie("", LOCAL)).toBeNull();
    expect(readSessionCookie("nonsense", LOCAL)).toBeNull();
    expect(readSessionCookie(`${SESSION_COOKIE}=`, LOCAL)).toBeNull();
    expect(readSessionCookie("other=1", LOCAL)).toBeNull();
  });

  // The header is attacker-controlled: a bare `%` makes `decodeURIComponent` throw, and a throw
  // here would come out of the router as a 500 instead of the 401 a bad cookie deserves.
  it("reads a malformed percent-escape as no cookie at all, and never throws", () => {
    for (const value of ["%", "%zz", "%E0%A4%A", "abc%", "%%"]) {
      expect(readSessionCookie(`${SESSION_COOKIE}=${value}`, LOCAL)).toBeNull();
    }
  });

  it("still finds a later well-formed cookie of another name after a malformed one", () => {
    expect(readSessionCookie(`${SESSION_COOKIE}=%; other=fine`, LOCAL)).toBeNull();
    expect(readSessionCookie(`other=%; ${SESSION_COOKIE}=abc123`, LOCAL)).toBe("abc123");
  });
});

describe("sessionSummary", () => {
  it("returns identifiers and expiry, never a token", () => {
    const session = createSession({ ...WHO, now: T0 });
    expect(sessionSummary(session)).toEqual({
      signedIn: true,
      userId: "usr_1",
      orgId: "org_1",
      tenantId: "tnt_1",
      expiresAt: T0 + IDLE_TIMEOUT_MS,
    });
  });
});

describe("AUTH_REASONS", () => {
  it("is the portal vocabulary plus this phase's session_required", () => {
    expect([...AUTH_REASONS].sort()).toEqual(
      [
        "device_revoked",
        "invalid_grant",
        "invalid_request",
        "org_inactive",
        "org_past_due",
        "portal_unavailable",
        "refresh_expired",
        "refresh_reused",
        "seat_cap_reached",
        "session_required",
        "session_revoked",
        "tenant_inactive",
        "user_inactive",
      ].sort(),
    );
  });
});
