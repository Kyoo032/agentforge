import { describe, expect, it } from "vitest";
import {
  checkCsrfToken,
  csrfCookieName,
  csrfSetCookie,
  CSRF_COOKIE,
  CSRF_COOKIE_SECURE,
  CSRF_HEADER,
  mintCsrfToken,
  readCsrfCookie,
} from "./csrf";

const LOCAL = { secure: false } as const;
const HOSTED = { secure: true } as const;

describe("mintCsrfToken", () => {
  it("mints a base64url token of 32 random bytes", () => {
    const token = mintCsrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("never repeats a token", () => {
    const tokens = new Set(Array.from({ length: 64 }, () => mintCsrfToken()));
    expect(tokens.size).toBe(64);
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
