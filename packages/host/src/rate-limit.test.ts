import { describe, expect, it } from "vitest";
import {
  AUTH_PATH_PREFIX,
  DEFAULT_AUTH_BURST,
  DEFAULT_AUTH_RPM,
  DEFAULT_IP_BURST,
  DEFAULT_IP_RPM,
  DEFAULT_SESSION_BURST,
  DEFAULT_SESSION_RPM,
  checkRequestRate,
  clientIp,
  createRateLimiter,
  isAuthPath,
  rateLimitConfig,
  resetRateLimiters,
  sessionRateKey,
} from "./rate-limit";

const SERVER = { AGENTFORGE_SERVER: "1" } as const;

describe("createRateLimiter token bucket", () => {
  it("spends the burst, then refuses until a token has refilled", () => {
    const limiter = createRateLimiter({ rpm: 60, burst: 2 });
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(true);
    const denied = limiter.take("a", 0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
    // 60 rpm is one token a second: half a second is still not enough.
    expect(limiter.take("a", 500).allowed).toBe(false);
    expect(limiter.take("a", 1000).allowed).toBe(true);
  });

  it("refills at rpm/60 tokens a second and never past the burst", () => {
    const limiter = createRateLimiter({ rpm: 600, burst: 5 });
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.take("a", 0).allowed).toBe(true);
    }
    expect(limiter.take("a", 0).allowed).toBe(false);
    // 600 rpm = 10 tokens a second, so one second refills far past the cap; only 5 are kept.
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.take("a", 1000).allowed).toBe(true);
    }
    expect(limiter.take("a", 1000).allowed).toBe(false);
  });

  it("rounds Retry-After up to whole seconds, never below one", () => {
    const limiter = createRateLimiter({ rpm: 6, burst: 1 });
    expect(limiter.take("a", 0).allowed).toBe(true);
    // 6 rpm is a token every 10s; 1s in, 9 are left.
    expect(limiter.take("a", 1_000).retryAfterSeconds).toBe(9);
    expect(limiter.take("a", 9_500).retryAfterSeconds).toBe(1);
  });

  it("keys are independent", () => {
    const limiter = createRateLimiter({ rpm: 60, burst: 1 });
    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 0).allowed).toBe(false);
    expect(limiter.take("b", 0).allowed).toBe(true);
  });

  it("is a no-op when rpm is zero or negative, so an operator can switch it off", () => {
    const limiter = createRateLimiter({ rpm: 0, burst: 10 });
    for (let i = 0; i < 50; i += 1) {
      expect(limiter.take("a", 0).allowed).toBe(true);
    }
    expect(limiter.size()).toBe(0);
  });
});

describe("createRateLimiter eviction", () => {
  it("keeps the map bounded and evicts the least recently used key", () => {
    const limiter = createRateLimiter({ rpm: 60, burst: 1, maxKeys: 3 });
    limiter.take("a", 0);
    limiter.take("b", 0);
    limiter.take("c", 0);
    // Touching "a" makes "b" the oldest, so "d" evicts "b" rather than "a".
    expect(limiter.take("a", 0).allowed).toBe(false);
    limiter.take("d", 0);
    expect(limiter.size()).toBe(3);
    // "a" is still spent; "b" came back as a fresh bucket.
    expect(limiter.take("a", 0).allowed).toBe(false);
    expect(limiter.take("b", 0).allowed).toBe(true);
  });

  it("never grows past maxKeys however many callers arrive", () => {
    const limiter = createRateLimiter({ rpm: 60, burst: 1, maxKeys: 10 });
    for (let i = 0; i < 500; i += 1) {
      limiter.take(`ip-${i}`, 0);
    }
    expect(limiter.size()).toBe(10);
  });
});

describe("clientIp", () => {
  it("takes the LAST X-Forwarded-For hop in server mode: the one the proxy in front appended", () => {
    // A client that sends its own `X-Forwarded-For: 1.1.1.1` has Caddy append the real peer after
    // it, so the first hop is attacker-chosen and only the last one was written by us.
    expect(clientIp({ forwardedFor: "1.1.1.1, 203.0.113.9", remoteAddress: "127.0.0.1", serverMode: true })).toBe(
      "203.0.113.9",
    );
    expect(clientIp({ forwardedFor: "203.0.113.9", remoteAddress: "127.0.0.1", serverMode: true })).toBe("203.0.113.9");
    expect(clientIp({ forwardedFor: "1.1.1.1 , 2.2.2.2 ,  203.0.113.9 ", remoteAddress: null, serverMode: true })).toBe(
      "203.0.113.9",
    );
  });

  it("cannot be spread over many buckets by a forged hop list", () => {
    const keys = new Set(
      ["1.1.1.1", "2.2.2.2", "3.3.3.3"].map((forged) =>
        clientIp({ forwardedFor: `${forged}, 203.0.113.9`, remoteAddress: "127.0.0.1", serverMode: true }),
      ),
    );
    expect([...keys]).toEqual(["203.0.113.9"]);
  });

  it("falls back to the socket address when the proxy sent no header", () => {
    expect(clientIp({ forwardedFor: undefined, remoteAddress: "10.1.2.3", serverMode: true })).toBe("10.1.2.3");
    expect(clientIp({ forwardedFor: "  ", remoteAddress: "10.1.2.3", serverMode: true })).toBe("10.1.2.3");
  });

  it("ignores X-Forwarded-For off server mode, where nothing in front is trusted", () => {
    expect(clientIp({ forwardedFor: "203.0.113.7", remoteAddress: "127.0.0.1", serverMode: false })).toBe("127.0.0.1");
    expect(clientIp({ forwardedFor: "1.1.1.1, 203.0.113.9", remoteAddress: "127.0.0.1", serverMode: false })).toBe(
      "127.0.0.1",
    );
  });

  it("falls back to the socket address when every hop is blank", () => {
    expect(clientIp({ forwardedFor: "1.1.1.1, ", remoteAddress: "10.1.2.3", serverMode: true })).toBe("10.1.2.3");
  });

  it("is null when there is no address at all", () => {
    expect(clientIp({ forwardedFor: null, remoteAddress: null, serverMode: true })).toBeNull();
  });
});

describe("sessionRateKey", () => {
  it("hashes the cookie value, so no session id reaches a bucket key or a log", () => {
    const key = sessionRateKey("session-value-abc");
    expect(key).not.toBeNull();
    expect(key).not.toContain("session-value-abc");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(sessionRateKey("session-value-abc")).toBe(key);
    expect(sessionRateKey("other")).not.toBe(key);
  });

  it("is null for an absent or empty cookie", () => {
    expect(sessionRateKey(undefined)).toBeNull();
    expect(sessionRateKey(null)).toBeNull();
    expect(sessionRateKey("   ")).toBeNull();
  });
});

describe("isAuthPath", () => {
  it("matches the portal login routes only", () => {
    expect(isAuthPath(`${AUTH_PATH_PREFIX}login`)).toBe(true);
    expect(isAuthPath("/api/v1/auth/refresh")).toBe(true);
    expect(isAuthPath("/api/v1/authors")).toBe(false);
    expect(isAuthPath("/api/v1/chat")).toBe(false);
  });
});

describe("rateLimitConfig", () => {
  it("uses the documented defaults", () => {
    expect(rateLimitConfig({})).toEqual({
      ip: { rpm: DEFAULT_IP_RPM, burst: DEFAULT_IP_BURST },
      session: { rpm: DEFAULT_SESSION_RPM, burst: DEFAULT_SESSION_BURST },
      auth: { rpm: DEFAULT_AUTH_RPM, burst: DEFAULT_AUTH_BURST },
    });
    expect(DEFAULT_IP_RPM).toBe(600);
    expect(DEFAULT_IP_BURST).toBe(100);
    expect(DEFAULT_SESSION_RPM).toBe(300);
    expect(DEFAULT_SESSION_BURST).toBe(50);
    expect(DEFAULT_AUTH_RPM).toBe(30);
    expect(DEFAULT_AUTH_BURST).toBe(10);
  });

  it("reads the three env overrides", () => {
    expect(
      rateLimitConfig({
        AGENTFORGE_RATE_IP_RPM: "120",
        AGENTFORGE_RATE_SESSION_RPM: "90",
        AGENTFORGE_RATE_AUTH_RPM: "6",
      }),
    ).toEqual({
      ip: { rpm: 120, burst: DEFAULT_IP_BURST },
      session: { rpm: 90, burst: DEFAULT_SESSION_BURST },
      auth: { rpm: 6, burst: 6 },
    });
  });

  it("ignores junk and clamps the burst to the rate", () => {
    expect(rateLimitConfig({ AGENTFORGE_RATE_IP_RPM: "not-a-number" }).ip.rpm).toBe(DEFAULT_IP_RPM);
    expect(rateLimitConfig({ AGENTFORGE_RATE_IP_RPM: "-5" }).ip.rpm).toBe(0);
    expect(rateLimitConfig({ AGENTFORGE_RATE_IP_RPM: "4" })).toMatchObject({ ip: { rpm: 4, burst: 4 } });
  });
});

describe("checkRequestRate", () => {
  const base = { path: "/api/v1/chat", ip: "203.0.113.7", sessionKey: null, env: SERVER, serverMode: true };

  it("does nothing off server mode, however many requests arrive", () => {
    resetRateLimiters();
    for (let i = 0; i < 2_000; i += 1) {
      expect(checkRequestRate({ ...base, serverMode: false, env: {}, now: 0 }).allowed).toBe(true);
    }
  });

  it("limits per IP at the configured burst and answers with Retry-After", () => {
    resetRateLimiters();
    for (let i = 0; i < DEFAULT_IP_BURST; i += 1) {
      expect(checkRequestRate({ ...base, now: 0 }).allowed).toBe(true);
    }
    const denied = checkRequestRate({ ...base, now: 0 });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.scope).toBe("ip");
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
  });

  it("holds auth routes to the tighter bucket the general one would still allow", () => {
    resetRateLimiters();
    const env = { ...SERVER, AGENTFORGE_RATE_AUTH_RPM: "30" };
    for (let i = 0; i < DEFAULT_AUTH_BURST; i += 1) {
      expect(checkRequestRate({ ...base, path: "/api/v1/auth/login", env, now: 0 }).allowed).toBe(true);
    }
    const denied = checkRequestRate({ ...base, path: "/api/v1/auth/login", env, now: 0 });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.scope).toBe("auth");
    }
    // The same IP is nowhere near the general per-IP burst, so ordinary traffic still flows.
    expect(checkRequestRate({ ...base, env, now: 0 }).allowed).toBe(true);
  });

  it("limits per session too, so one account cannot spread a flood over many IPs", () => {
    resetRateLimiters();
    const sessionKey = sessionRateKey("one-session");
    for (let i = 0; i < DEFAULT_SESSION_BURST; i += 1) {
      expect(checkRequestRate({ ...base, ip: `198.51.100.${i}`, sessionKey, now: 0 }).allowed).toBe(true);
    }
    const denied = checkRequestRate({ ...base, ip: "198.51.100.200", sessionKey, now: 0 });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.scope).toBe("session");
    }
  });

  it("skips the IP bucket when there is no address to key on", () => {
    resetRateLimiters();
    for (let i = 0; i < 1_000; i += 1) {
      expect(checkRequestRate({ ...base, ip: null, now: 0 }).allowed).toBe(true);
    }
  });

  it("rebuilds its limiters after a reset, so one test never leaks into the next", () => {
    resetRateLimiters();
    for (let i = 0; i < DEFAULT_IP_BURST; i += 1) {
      checkRequestRate({ ...base, now: 0 });
    }
    expect(checkRequestRate({ ...base, now: 0 }).allowed).toBe(false);
    resetRateLimiters();
    expect(checkRequestRate({ ...base, now: 0 }).allowed).toBe(true);
  });
});
