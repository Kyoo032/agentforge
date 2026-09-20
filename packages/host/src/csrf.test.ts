import { describe, expect, it } from "vitest";
import {
  checkCsrfToken,
  csrfCookieName,
  csrfSetCookie,
  csrfTokenMatchesSession,
  CSRF_COOKIE,
  CSRF_COOKIE_SECURE,
  CSRF_HEADER,
  mintCsrfToken,
  mintCsrfTokenFor,
  readCsrfCookie,
} from "./csrf";

const LOCAL = { secure: false } as const;
const HOSTED = { secure: true } as const;

describe("mintCsrfToken", () => {
  // Since Phase 3 lane C the token is `<salt>.<HMAC>`, not bare randomness: a 16-byte salt in
  // base64url (22 chars) and a SHA-256 digest in base64url (43 chars).
  it("mints a salt and a signature, both base64url", () => {
    const token = mintCsrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 64 }, () => mintCsrfToken()));
    expect(tokens.size).toBe(64);
  });

  it("never repeats a token for one session either, because the salt is fresh", () => {
    const tokens = new Set(Array.from({ length: 64 }, () => mintCsrfTokenFor("session-1")));
    expect(tokens.size).toBe(64);
  });
});

describe("csrfTokenMatchesSession", () => {
  it("verifies a token against the session it was minted for", () => {
    expect(csrfTokenMatchesSession(mintCsrfTokenFor("session-1"), "session-1")).toBe(true);
  });

  it("refuses a token minted for a different session", () => {
    expect(csrfTokenMatchesSession(mintCsrfTokenFor("session-1"), "session-2")).toBe(false);
  });

  it("refuses an anonymous token once the browser has a session, and the reverse", () => {
    expect(csrfTokenMatchesSession(mintCsrfTokenFor(null), "session-1")).toBe(false);
    expect(csrfTokenMatchesSession(mintCsrfTokenFor("session-1"), null)).toBe(false);
  });

  it("treats a missing session id and an empty one as the same anonymous binding", () => {
    const token = mintCsrfTokenFor(null);
    expect(csrfTokenMatchesSession(token, undefined)).toBe(true);
    expect(csrfTokenMatchesSession(token, "")).toBe(true);
  });

  it("refuses a malformed token without throwing", () => {
    for (const bad of ["", ".", "nodot", "a.b.c", ".sig", "salt."]) {
      expect(csrfTokenMatchesSession(bad, "session-1")).toBe(false);
    }
    expect(csrfTokenMatchesSession(null, "session-1")).toBe(false);
  });

  it("refuses a token whose signature was tampered with but whose salt was kept", () => {
    const token = mintCsrfTokenFor("session-1");
    const [salt] = token.split(".");
    expect(csrfTokenMatchesSession(`${salt}.${"A".repeat(43)}`, "session-1")).toBe(false);
  });
});

describe("checkCsrfToken binds the pair to the session", () => {
  it("accepts a matching pair minted for this session", () => {
    const token = mintCsrfTokenFor("session-1");
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, token, LOCAL, "session-1").ok).toBe(true);
  });

  // The attack this closes: two people on one machine, or a cookie lifted from another browser.
  // The double-submit pair still matches — it is the same pair — so only the binding refuses it.
  it("refuses a matching pair that was minted for another session", () => {
    const token = mintCsrfTokenFor("session-1");
    const result = checkCsrfToken({ [CSRF_COOKIE]: token }, token, LOCAL, "session-2");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("csrf_invalid");
  });

  it("refuses a pair minted before the browser signed in", () => {
    const token = mintCsrfTokenFor(null);
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, token, LOCAL, "session-1").code).toBe("csrf_invalid");
  });

  it("accepts an anonymous pair when there is no session, which is webdev and the desktop", () => {
    const token = mintCsrfToken();
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, token, LOCAL).ok).toBe(true);
  });
});

describe("csrfCookieName", () => {
  it("uses the __Host- prefixed name on the hosted server and the plain one off it", () => {
    expect(csrfCookieName(HOSTED)).toBe(CSRF_COOKIE_SECURE);
    expect(csrfCookieName(LOCAL)).toBe(CSRF_COOKIE);
    expect(CSRF_COOKIE_SECURE).toBe("__Host-agentforge_csrf");
    expect(CSRF_COOKIE).toBe("agentforge_csrf");
  });

  it("does not collide with the workspace cookie name, and keeps the header name stable", () => {
    expect(CSRF_HEADER).toBe("x-agentforge-csrf");
    expect(CSRF_COOKIE).not.toBe("agentforge_workspace");
  });
});

describe("csrfSetCookie", () => {
  it("is readable by the renderer, scoped to the whole app, and Lax off the server", () => {
    const value = csrfSetCookie("abc", LOCAL);
    expect(value.startsWith(`${CSRF_COOKIE}=abc;`)).toBe(true);
    expect(value).toContain("Path=/");
    expect(value).toContain("SameSite=Lax");
    expect(value).not.toContain("HttpOnly");
    expect(value).not.toContain("Secure");
  });

  it("uses the plain name off the server, because a browser rejects __Host- over plain http", () => {
    expect(csrfSetCookie("abc", LOCAL)).not.toContain(CSRF_COOKIE_SECURE);
  });

  it("uses the __Host- prefix on the hosted server, with everything that prefix requires", () => {
    const value = csrfSetCookie("abc", HOSTED);
    expect(value.startsWith(`${CSRF_COOKIE_SECURE}=abc;`)).toBe(true);
    // The three conditions a browser checks before it accepts a __Host- cookie.
    expect(value).toContain("; Secure");
    expect(value).toContain("Path=/");
    expect(value.toLowerCase()).not.toContain("domain=");
  });

  it("percent-encodes a token that carries cookie punctuation", () => {
    expect(csrfSetCookie("a;b c", LOCAL)).toContain(`${CSRF_COOKIE}=a%3Bb%20c;`);
    expect(csrfSetCookie("a;b c", HOSTED)).toContain(`${CSRF_COOKIE_SECURE}=a%3Bb%20c;`);
  });
});

describe("readCsrfCookie", () => {
  it("reads the name the mode uses and ignores the other one", () => {
    const jar = { [CSRF_COOKIE]: "local-token", [CSRF_COOKIE_SECURE]: "hosted-token" };
    expect(readCsrfCookie(jar, HOSTED)).toBe("hosted-token");
    expect(readCsrfCookie(jar, LOCAL)).toBe("local-token");
  });

  it("returns undefined when the mode's cookie is absent or empty", () => {
    expect(readCsrfCookie({ [CSRF_COOKIE]: "local-token" }, HOSTED)).toBeUndefined();
    expect(readCsrfCookie({}, LOCAL)).toBeUndefined();
    expect(readCsrfCookie({ [CSRF_COOKIE]: "" }, LOCAL)).toBeUndefined();
  });
});

describe("checkCsrfToken", () => {
  const token = mintCsrfToken();

  it("accepts a header that equals the cookie the mode uses", () => {
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, token, LOCAL)).toEqual({ ok: true });
    expect(checkCsrfToken({ [CSRF_COOKIE_SECURE]: token }, token, HOSTED)).toEqual({ ok: true });
  });

  it("ignores a token stored under the other mode's cookie name", () => {
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, token, HOSTED).code).toBe("csrf_missing");
    expect(checkCsrfToken({ [CSRF_COOKIE_SECURE]: token }, token, LOCAL).code).toBe("csrf_missing");
  });

  it("reports csrf_missing when either half is absent", () => {
    expect(checkCsrfToken({}, token, LOCAL).code).toBe("csrf_missing");
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, undefined, LOCAL).code).toBe("csrf_missing");
    expect(checkCsrfToken({ [CSRF_COOKIE]: "" }, "", LOCAL).code).toBe("csrf_missing");
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, "   ", LOCAL).code).toBe("csrf_missing");
    expect(checkCsrfToken({}, null, LOCAL).code).toBe("csrf_missing");
  });

  it("reports csrf_invalid for a token minted for another session", () => {
    const result = checkCsrfToken({ [CSRF_COOKIE]: token }, mintCsrfToken(), LOCAL);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("csrf_invalid");
  });

  it("reports csrf_invalid for a token of a different length, without throwing", () => {
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, `${token}extra`, LOCAL).code).toBe("csrf_invalid");
    expect(checkCsrfToken({ [CSRF_COOKIE]: token }, token.slice(0, 10), LOCAL).code).toBe("csrf_invalid");
  });

  it("carries a message the API envelope can show, and no token in it", () => {
    const result = checkCsrfToken({ [CSRF_COOKIE]: token }, "wrong", LOCAL);
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
    expect(result.message).not.toContain(token);
  });
});
