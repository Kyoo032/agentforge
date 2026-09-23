import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveKeyring } from "../jwt/keys";
import { fixedClock } from "../testing/pg";
import { boundedField, parseFormBody, parseJsonBody, stringField } from "./body";
import { clearCookie, cookieNames, cookiesAreSecure, parseCookies, serialiseCookie } from "./cookies";
import { clientIp, rateLimitKey } from "./client-ip";
import { csrfMatches, mintCsrfToken } from "./csrf";
import { formActionSource, htmlResponse, redirectResponse } from "./headers";
import { createPortalLimiters, createRateLimiter } from "./rate-limit";
import { mintWebSession, readWebSession, webSessionSecret, WEB_SESSION_TTL_MS } from "./web-session";

const KEY = resolveKeyring({ production: false, signingKey: Buffer.alloc(32, 4) }).current;
const SECRET = webSessionSecret(KEY);
const NOW = Date.UTC(2026, 8, 21, 8, 0, 0);

describe("cookie names and the __Host- prefix", () => {
  it("drops the prefix only for a development process on loopback", () => {
    expect(cookieNames({ production: false, host: "127.0.0.1" })).toEqual({
      session: "portal_session",
      csrf: "portal_csrf",
    });
    expect(cookiesAreSecure({ production: false, host: "127.0.0.1" })).toBe(false);
  });

  it("keeps the prefix in production, even on loopback", () => {
    expect(cookieNames({ production: true, host: "127.0.0.1" }).session).toBe("__Host-portal_session");
    expect(cookiesAreSecure({ production: true, host: "127.0.0.1" })).toBe(true);
  });

  it("keeps the prefix for a development process bound to a real interface", () => {
    expect(cookieNames({ production: false, host: "0.0.0.0" }).session).toBe("__Host-portal_session");
    expect(cookieNames({ production: false, host: "10.0.0.4" }).csrf).toBe("__Host-portal_csrf");
  });

  /**
   * The case the loopback rule missed, found while setting the review instance up for a tunnel.
   *
   * `PORTAL_HOST` is what the process BINDS to, and behind a tunnel that is still `127.0.0.1`
   * while the browser reaches the portal at `https://<name>.trycloudflare.com`. The rule read only
   * the bind address, so a portal published over public HTTPS kept issuing `portal_session` — no
   * `Secure`, no `__Host-` — for a thirty-day cookie on a public name. Any plain-http request to
   * that hostname carries it in the clear, and without the prefix a sibling host can write it,
   * which is the session fixation the prefix exists to stop.
   *
   * `PORTAL_PUBLIC_URL` is what a deployment states it is reached on, and it is already required
   * behind a proxy for `iss` to be right, so it is the fact worth reading.
   */
  it("keeps the prefix when the public URL is https, whatever the bind address is", () => {
    const behindTunnel = {
      production: false,
      host: "127.0.0.1",
      publicUrl: "https://portal.example.trycloudflare.com",
    };
    expect(cookiesAreSecure(behindTunnel)).toBe(true);
    expect(cookieNames(behindTunnel)).toEqual({
      session: "__Host-portal_session",
      csrf: "__Host-portal_csrf",
    });
  });

  it("still drops the prefix for the loopback review instance, which has no TLS of its own", () => {
    const loopback = { production: false, host: "127.0.0.1", publicUrl: "http://127.0.0.1:4000" };
    expect(cookiesAreSecure(loopback)).toBe(false);
    expect(cookieNames(loopback).session).toBe("portal_session");
  });

  it("writes the attributes a __Host- cookie needs, and no Domain", () => {
    const header = serialiseCookie("__Host-portal_session", "abc", {
      secure: true,
      maxAgeSeconds: 60,
    });
    expect(header).toBe("__Host-portal_session=abc; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60");
    expect(header).not.toContain("Domain");
  });

  it("clears a cookie with Max-Age=0", () => {
    expect(clearCookie("portal_session", false)).toBe(
      "portal_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
  });

  it("reads back the names the server set", () => {
    expect(parseCookies("portal_csrf=xy; portal_session=ab.cd; other=1")).toEqual({
      portal_csrf: "xy",
      portal_session: "ab.cd",
      other: "1",
    });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("the portal's own browser session", () => {
  const session = { tenantId: "tnt-1", userId: "usr-1", orgId: "org-1", installId: "web-agentforge", ver: 1 };

  it("round-trips the claims it was minted with", () => {
    const cookie = mintWebSession(SECRET, session, NOW);
    expect(readWebSession(SECRET, cookie, NOW + 1000)).toEqual({
      ...session,
      issuedAt: NOW,
      expiresAt: NOW + WEB_SESSION_TTL_MS,
    });
  });

  it("lasts thirty days and not a millisecond longer", () => {
    const cookie = mintWebSession(SECRET, session, NOW);
    expect(readWebSession(SECRET, cookie, NOW + WEB_SESSION_TTL_MS - 1)).not.toBeNull();
    expect(readWebSession(SECRET, cookie, NOW + WEB_SESSION_TTL_MS)).toBeNull();
  });

  it("refuses a cookie whose claims were edited", () => {
    const cookie = mintWebSession(SECRET, session, NOW);
    const [body, mac] = cookie.split(".");
    const edited = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    edited.userId = "usr-2";
    const forged = `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${mac}`;

    expect(readWebSession(SECRET, forged, NOW)).toBeNull();
  });

  it("refuses a cookie minted under another signing key", () => {
    const other = webSessionSecret(
      resolveKeyring({ production: false, signingKey: Buffer.alloc(32, 5) }).current,
    );
    expect(readWebSession(SECRET, mintWebSession(other, session, NOW), NOW)).toBeNull();
  });

  it("refuses nonsense without throwing", () => {
    for (const value of [undefined, "", ".", "abc", "a.b.c"]) {
      expect(readWebSession(SECRET, value, NOW)).toBeNull();
    }
  });

  /**
   * SR-21. The cookie carries the version it was minted under so a bump of
   * `web_session_versions` ends it on the next request. A payload from before that field existed
   * is refused rather than read as version 1: the server decides, and it cannot decide about a
   * shape it does not recognise.
   */
  it("carries the revocation version, and refuses a payload without one", () => {
    expect(readWebSession(SECRET, mintWebSession(SECRET, { ...session, ver: 7 }, NOW), NOW)?.ver).toBe(7);

    const legacy = { v: 1, ...session, issuedAt: NOW, expiresAt: NOW + WEB_SESSION_TTL_MS };
    delete (legacy as { ver?: number }).ver;
    const body = Buffer.from(JSON.stringify(legacy), "utf8").toString("base64url");
    const mac = createHmac("sha256", SECRET).update(body, "ascii").digest("base64url");
    expect(readWebSession(SECRET, `${body}.${mac}`, NOW)).toBeNull();
  });

  it("derives the same secret from the same signing key across processes", () => {
    const again = resolveKeyring({ production: false, signingKey: Buffer.alloc(32, 4) }).current;
    expect(webSessionSecret(again).equals(SECRET)).toBe(true);
  });
});

describe("CSRF double submit", () => {
  it("accepts the token it minted and refuses a different one", () => {
    const token = mintCsrfToken();
    expect(csrfMatches(token, token)).toBe(true);
    expect(csrfMatches(token, mintCsrfToken())).toBe(false);
  });

  it("refuses a missing half, which is what a cross-site post has", () => {
    const token = mintCsrfToken();
    expect(csrfMatches(undefined, token)).toBe(false);
    expect(csrfMatches(token, undefined)).toBe(false);
    expect(csrfMatches("", "")).toBe(false);
  });
});

describe("rate limiting", () => {
  it("allows the limit and refuses the next one, with a retry-after inside the window", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 3 });

    expect([limiter.check("a"), limiter.check("a"), limiter.check("a")].map((v) => v.ok)).toEqual([
      true,
      true,
      true,
    ]);
    const refused = limiter.check("a");
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBe(60);
  });

  it("keeps separate keys apart", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 1 });
    limiter.check("a");
    expect(limiter.check("a").ok).toBe(false);
    expect(limiter.check("b").ok).toBe(true);
  });

  it("forgives once the window rolls", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 1 });
    limiter.check("a");
    expect(limiter.check("a").ok).toBe(false);
    clock.advance(60_001);
    expect(limiter.check("a").ok).toBe(true);
  });

  it("peeks without spending the budget", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 1 });
    expect(limiter.peek("a").ok).toBe(true);
    expect(limiter.peek("a").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.peek("a").ok).toBe(false);
  });

  /**
   * The map is capped so the limiter cannot become the memory exhaustion it defends against. It
   * used to REFUSE every new key once the cap was full of live windows, so a flood of distinct keys
   * (one IPv6 /64 holds more than enough addresses) locked every new caller out for a whole window.
   * It evicts the oldest window instead. Evicting lets a flooder reset a window, but a flooder with
   * that many addresses could already start fresh windows by rotating addresses, so the cap still
   * bounds memory and no longer locks anybody out.
   */
  it("stops growing at maxKeys by evicting the oldest window, not by refusing the next caller", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 5, maxKeys: 4 });
    for (let i = 0; i < 4; i += 1) {
      expect(limiter.check(`k${i}`).ok).toBe(true);
    }

    expect(limiter.check("k4").ok).toBe(true);
    expect(limiter.size).toBe(4);
  });

  it("keeps a flood of new keys from locking a new caller out", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 1, maxKeys: 3 });
    limiter.check("k0");
    limiter.check("k1");
    limiter.check("k2");
    expect(limiter.check("k1").ok).toBe(false);

    for (let i = 0; i < 1_000; i += 1) {
      clock.advance(1);
      expect(limiter.check(`flood-${i}`).ok).toBe(true);
    }
    expect(limiter.size).toBe(3);
    // The honest caller who arrives after the flood gets a window of their own.
    expect(limiter.check("honest").ok).toBe(true);
  });

  /**
   * `Map#set` on a key that is already there keeps the key's ORIGINAL position, so a key whose
   * window rolled over and restarted would still sit at the front and be taken for the oldest.
   */
  it("evicts the window that started first, even when an older key restarted its window later", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 1, maxKeys: 3 });
    limiter.check("a");
    clock.advance(60_001);
    limiter.check("b");
    clock.advance(1);
    // `a`'s first window has rolled, so this starts a new one, which is younger than `b`'s.
    expect(limiter.check("a").ok).toBe(true);
    limiter.check("c");

    // Full, nothing expired: the oldest live window is `b`'s, and that is the one that goes.
    expect(limiter.check("d").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(false);
    expect(limiter.check("b").ok).toBe(true);
  });

  /**
   * The host refreshes every hosted session through the portal every ~10 minutes, all from one
   * address, so 300 per address per 10 minutes capped the hosted app at ~300 active sessions. A
   * refresh from an authenticated confidential client is counted against the CLIENT instead.
   */
  it("gives a confidential client 20,000 refreshes per 10 minutes, keyed on its client_id", () => {
    const limiters = createPortalLimiters(fixedClock(new Date(NOW)));
    let allowed = 0;
    while (limiters.tokenClient.check("agentforge-web").ok) {
      allowed += 1;
    }
    expect(allowed).toBe(20_000);
    expect(limiters.tokenClient.check("another-client").ok).toBe(true);
    // The public, per-address bucket is untouched by any of that.
    expect(limiters.tokenIp.peek("198.51.100.1").ok).toBe(true);
  });

  it("bounds failed client authentications on a refresh at 20 per 10 minutes per address", () => {
    const limiters = createPortalLimiters(fixedClock(new Date(NOW)));
    let allowed = 0;
    while (limiters.tokenClientAuthFailIp.check("203.0.113.5").ok) {
      allowed += 1;
    }
    expect(allowed).toBe(20);
  });

  it("treats a cap below one as one, rather than looping on an empty map", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 1, maxKeys: 0 });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("b").ok).toBe(true);
    expect(limiter.size).toBe(1);
  });

  it("sweeps expired windows before it evicts a live one", () => {
    const clock = fixedClock(new Date(NOW));
    const limiter = createRateLimiter({ clock, windowMs: 60_000, max: 1, maxKeys: 3 });
    limiter.check("old-1");
    limiter.check("old-2");
    clock.advance(30_000);
    limiter.check("live");
    clock.advance(30_001);

    expect(limiter.check("new").ok).toBe(true);
    expect(limiter.size).toBe(2);
    expect(limiter.check("live").ok).toBe(false);
  });
});

describe("client address", () => {
  const headers = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };

  it("ignores X-Forwarded-For unless the proxy flag is set", () => {
    expect(clientIp({ headers, socketIp: "127.0.0.1", trustProxy: false })).toBe("127.0.0.1");
  });

  /**
   * The proxy in front (Caddy, `webapp-deploy/Caddyfile`) APPENDS the peer it saw, or replaces the
   * header outright; either way the right-most entry is the only one it wrote. Everything to the
   * left came from the client. Reading the left-most let any caller pick its own rate-limit bucket
   * per request, and pick somebody else's to exhaust.
   */
  it("takes the right-most forwarded address, the one the proxy in front wrote", () => {
    expect(clientIp({ headers, socketIp: "127.0.0.1", trustProxy: true })).toBe("10.0.0.1");
  });

  it("cannot be steered by a forged prefix: rotating it leaves the same address", () => {
    const seen = new Set(
      ["6.6.6.6", "7.7.7.7, 8.8.8.8", "not-an-ip", "", "203.0.113.200"].map((forged) =>
        clientIp({
          headers: { "x-forwarded-for": `${forged}, 198.51.100.7` },
          socketIp: "127.0.0.1",
          trustProxy: true,
        }),
      ),
    );
    expect([...seen]).toEqual(["198.51.100.7"]);
  });

  it("falls back to the socket, never to a client-written entry, when the last hop is not an address", () => {
    for (const header of ["203.0.113.9, not-an-ip", "203.0.113.9, 198.51.100.7:4711", "203.0.113.9,", "203.0.113.9, "]) {
      expect(clientIp({ headers: { "x-forwarded-for": header }, socketIp: "10.0.0.2", trustProxy: true }), header).toBe(
        "10.0.0.2",
      );
    }
  });

  it("reads the last hop across repeated header lines, and normalises it", () => {
    expect(
      clientIp({ headers: { "x-forwarded-for": ["6.6.6.6", "198.51.100.7"] }, socketIp: null, trustProxy: true }),
    ).toBe("198.51.100.7");
    expect(
      clientIp({ headers: { "x-forwarded-for": " 6.6.6.6 ,  ::ffff:198.51.100.7 " }, socketIp: null, trustProxy: true }),
    ).toBe("198.51.100.7");
    expect(
      clientIp({ headers: { "x-forwarded-for": "6.6.6.6, [2001:db8::7]" }, socketIp: null, trustProxy: true }),
    ).toBe("2001:db8::7");
  });

  it("falls back to the socket when the header is not an address", () => {
    expect(
      clientIp({ headers: { "x-forwarded-for": "not-an-ip" }, socketIp: "::1", trustProxy: true }),
    ).toBe("::1");
  });

  it("unwraps the v4-in-v6 form node hands it, so inet takes the value", () => {
    expect(clientIp({ headers: {}, socketIp: "::ffff:192.0.2.7", trustProxy: false })).toBe("192.0.2.7");
  });

  it("answers null rather than a value inet would refuse", () => {
    expect(clientIp({ headers: {}, socketIp: "garbage", trustProxy: false })).toBeNull();
    expect(clientIp({ headers: {}, socketIp: "999.1.1.1", trustProxy: false })).toBeNull();
    expect(rateLimitKey(null)).toBe("unknown-ip");
  });

  /**
   * SR-33: the flag used to be read straight from `process.env` here. It is `loadConfig`'s now --
   * `src/config.test.ts`, "reads PORTAL_TRUST_PROXY through the same flag reader" -- and this
   * module takes the decision as an argument, so there is one place a typo can be caught.
   */
  it("takes the proxy decision as an argument and reads no environment", () => {
    const source = readFileSync(new URL("./client-ip.ts", import.meta.url), "utf8");
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/env\[/);
  });
});

describe("response headers", () => {
  it("forbids script, framing and a third-party form action on every page", () => {
    const { headers } = htmlResponse("<p>hi</p>");
    expect(headers?.["content-security-policy"]).toContain("script-src 'none'");
    expect(headers?.["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers?.["content-security-policy"]).toContain("form-action 'self'");
    expect(headers?.["x-frame-options"]).toBe("DENY");
    expect(headers?.["referrer-policy"]).toBe("no-referrer");
    expect(headers?.["cache-control"]).toContain("no-store");
  });

  it("keeps no-referrer on the redirect that carries the authorization code", () => {
    const response = redirectResponse("https://localhost:3443/auth/callback?code=x&state=y");
    expect(response.status).toBe(302);
    expect(response.headers?.["referrer-policy"]).toBe("no-referrer");
    expect(response.headers?.["cache-control"]).toBe("no-store");
  });

  it("sets the cookie it was given and none when it was given none", () => {
    expect(htmlResponse("x", { cookie: "portal_csrf=a; Path=/" }).headers?.["set-cookie"]).toBe(
      "portal_csrf=a; Path=/",
    );
    expect(htmlResponse("x").headers?.["set-cookie"]).toBeUndefined();
  });
});

/**
 * The bug this covers: `form-action 'self'` on every page blocked the OAuth sign-in in a real
 * browser. Chromium enforces `form-action` across the whole redirect chain of a submission, and
 * `POST /authorize/verify` answers `302 Location: <client redirect_uri>` on ANOTHER origin, so the
 * submission never left the page. curl follows the same 302 happily, which is why no drive caught
 * it. See `docs/internal/security-register.md`, SR-20.
 */
describe("form-action on an authorize page", () => {
  it("names the client's origin beside 'self', and nothing but the origin", () => {
    const { headers } = htmlResponse("<p>hi</p>", {
      formActionOrigins: ["https://client.example/auth/callback?next=%2Fchat"],
    });
    const csp = headers?.["content-security-policy"] as string;

    expect(csp).toContain("form-action 'self' https://client.example;");
    // The emitted source is exactly the URL's origin: no path, no query, no trailing slash.
    expect(csp).not.toContain("/auth/callback");
    expect(csp).not.toContain("next=");
  });

  it("emits new URL(x).origin verbatim, port and all", () => {
    for (const uri of [
      "https://localhost:3443/auth/callback",
      "https://app.example.trycloudflare.com/auth/callback",
      "http://127.0.0.1:3100/auth/callback",
    ]) {
      const expected = new URL(uri).origin;
      expect(formActionSource(uri)).toBe(expected);
      expect(htmlResponse("x", { formActionOrigins: [uri] }).headers?.[
        "content-security-policy"
      ]).toContain(`form-action 'self' ${expected};`);
    }
  });

  it("cannot be used to inject a directive, a header or a wildcard", () => {
    // Every one of these is already impossible upstream -- a redirect_uri reaches this function
    // only after an exact match against the client's registered allowlist. Asserted anyway,
    // because "it cannot get here" is not a property the serialiser should rely on.
    const hostile = [
      "https://ok.example/a;script-src *",
      "https://ok.example/a; form-action *",
      "https://ok.example/\r\nx-evil: 1",
      "https://ok.example/ https://evil.example",
      // These two are the ones that survive `URL.origin`: neither `,` nor `;` is a forbidden host
      // code point. A `;` would start a directive of its own, and a `,` splits the header into two
      // policies, dropping `frame-ancestors` and `base-uri` from the first.
      "https://evil.example;script-src *",
      "https://evil.example,default-src *",
      "https://evil.example`x",
      "javascript:alert(1)",
      "data:text/html,<form>",
      "*",
      "https:",
      "not a url at all",
      "",
    ];
    for (const value of hostile) {
      const csp = htmlResponse("x", { formActionOrigins: [value] }).headers?.[
        "content-security-policy"
      ] as string;
      const directive = csp.split("; ").find((part) => part.startsWith("form-action")) as string;
      expect(directive === "form-action 'self'" || directive === "form-action 'self' https://ok.example").toBe(true);
      expect(csp).not.toContain("*");
      expect(csp).not.toContain("evil");
      expect(csp).not.toContain("\r");
      expect(csp).not.toContain("\n");
      // One `form-action`, one policy: a comma anywhere in the header would make it two.
      expect(csp.split("; ").filter((part) => part.startsWith("form-action"))).toHaveLength(1);
      expect(csp).not.toContain(",");
    }
    expect(formActionSource("javascript:alert(1)")).toBeNull();
    expect(formActionSource("*")).toBeNull();
    expect(formActionSource("https:")).toBeNull();
    expect(formActionSource("https://evil.example,default-src *")).toBeNull();
    expect(formActionSource("https://evil.example;script-src *")).toBeNull();
    // ...while the origins a real client registers still pass, punycode and IPv6 included.
    expect(formActionSource("https://xn--bcher-kva.example/cb")).toBe("https://xn--bcher-kva.example");
    expect(formActionSource("http://[::1]:4000/cb")).toBe("http://[::1]:4000");
  });

  it("leaves every page that passes nothing on 'self' alone", () => {
    for (const options of [{}, { formActionOrigins: [] }]) {
      expect(htmlResponse("x", options).headers?.["content-security-policy"]).toContain(
        "form-action 'self';",
      );
    }
  });

  it("keeps the rest of the policy byte-identical", () => {
    const without = htmlResponse("x").headers?.["content-security-policy"] as string;
    const with_ = htmlResponse("x", {
      formActionOrigins: ["https://client.example/cb"],
    }).headers?.["content-security-policy"] as string;

    expect(with_.replace(" https://client.example", "")).toBe(without);
  });
});

describe("request bodies", () => {
  it("reads a JSON object and refuses everything else", () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ ok: true, fields: { a: 1 } });
    expect(parseJsonBody("")).toEqual({ ok: true, fields: {} });
    expect(parseJsonBody("[1,2]")).toEqual({ ok: false, reason: "malformed" });
    expect(parseJsonBody("{")).toEqual({ ok: false, reason: "malformed" });
    expect(parseJsonBody('"x"')).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a body over the endpoint's own cap, below the server's 64 KB", () => {
    const big = JSON.stringify({ a: "x".repeat(9000) });
    expect(parseJsonBody(big)).toEqual({ ok: false, reason: "too_large" });
    expect(parseJsonBody(big, 16 * 1024).ok).toBe(true);
  });

  it("reads a form body, last value winning on a duplicated name", () => {
    expect(parseFormBody("email=a%40b.test&code=123456&code=999999")).toEqual({
      ok: true,
      fields: { email: "a@b.test", code: "999999" },
    });
  });

  it("narrows a field to a trimmed non-empty string", () => {
    const fields = { a: "  x  ", b: "", c: 7, d: "abcdef" };
    expect(stringField(fields, "a")).toBe("x");
    expect(stringField(fields, "b")).toBeNull();
    expect(stringField(fields, "c")).toBeNull();
    expect(stringField(fields, "missing")).toBeNull();
    expect(boundedField(fields, "d", 6)).toBe("abcdef");
    expect(boundedField(fields, "d", 5)).toBeNull();
  });
});
