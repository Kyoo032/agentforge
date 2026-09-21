/**
 * Phase 9 lane F — the login-CSRF `state` and the cookie that carries it.
 *
 * The state is the only thing standing between a signed-in tenant and an attacker who can get a
 * browser to POST somebody else's authorization code at `/api/v1/auth/login`, so the two properties
 * that matter are driven here rather than assumed: the cookie is read back under this mode's name
 * only, and the comparison never short-circuits on the first differing byte.
 */
import { describe, expect, it } from "vitest";
import {
  LOGIN_STATE_BYTES,
  LOGIN_STATE_COOKIE,
  LOGIN_STATE_COOKIE_SECURE,
  LOGIN_STATE_MAX_AGE_SECONDS,
  loginStateCookieName,
  mintLoginState,
  readLoginStateCookie,
  statesMatch,
} from "./login-state";

const HOSTED = { secure: true } as const;
const LOCAL = { secure: false } as const;

describe("mintLoginState", () => {
  it("is 32 random bytes as base64url", () => {
    expect(LOGIN_STATE_BYTES).toBe(32);
    expect(mintLoginState()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintLoginState()));
    expect(seen.size).toBe(200);
  });
});

describe("loginStateCookieName", () => {
  it("prefixes with __Host- on the hosted server and leaves it plain off it", () => {
    expect(loginStateCookieName(HOSTED)).toBe(LOGIN_STATE_COOKIE_SECURE);
    expect(loginStateCookieName(LOCAL)).toBe(LOGIN_STATE_COOKIE);
    expect(LOGIN_STATE_COOKIE_SECURE).toBe(`__Host-${LOGIN_STATE_COOKIE}`);
  });

  it("is a short-lived cookie: ten minutes, the window the authorize hop needs", () => {
    expect(LOGIN_STATE_MAX_AGE_SECONDS).toBe(600);
  });
});

describe("readLoginStateCookie", () => {
  it("reads this mode's name out of a raw Cookie header", () => {
    const header = `${LOGIN_STATE_COOKIE_SECURE}=abc; __Host-agentforge_session=zzz`;
    expect(readLoginStateCookie(header, HOSTED)).toBe("abc");
  });

  it("ignores the other mode's name entirely", () => {
    expect(readLoginStateCookie(`${LOGIN_STATE_COOKIE}=abc`, HOSTED)).toBeNull();
    expect(readLoginStateCookie(`${LOGIN_STATE_COOKIE_SECURE}=abc`, LOCAL)).toBeNull();
  });

  it("is null for an absent, empty or undecodable value rather than throwing", () => {
    expect(readLoginStateCookie(null, HOSTED)).toBeNull();
    expect(readLoginStateCookie("", HOSTED)).toBeNull();
    expect(readLoginStateCookie("other=1", HOSTED)).toBeNull();
    expect(readLoginStateCookie(`${LOGIN_STATE_COOKIE_SECURE}=`, HOSTED)).toBeNull();
    // An attacker-controlled `%` must read as "no cookie", not surface as a 500.
    expect(readLoginStateCookie(`${LOGIN_STATE_COOKIE_SECURE}=%zz`, HOSTED)).toBeNull();
  });

  it("does not match a name that merely ends with the cookie's name", () => {
    expect(readLoginStateCookie(`x${LOGIN_STATE_COOKIE_SECURE}=abc`, HOSTED)).toBeNull();
  });
});

describe("statesMatch", () => {
  it("matches an identical pair", () => {
    const state = mintLoginState();
    expect(statesMatch(state, state)).toBe(true);
  });

  it("refuses a different pair, whatever its length", () => {
    expect(statesMatch(mintLoginState(), mintLoginState())).toBe(false);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch("a", "a-very-much-longer-value")).toBe(false);
  });

  it("refuses anything missing rather than treating it as a match", () => {
    expect(statesMatch(null, null)).toBe(false);
    expect(statesMatch(undefined, "abc")).toBe(false);
    expect(statesMatch("abc", "")).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });
});
