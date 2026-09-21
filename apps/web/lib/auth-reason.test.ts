/**
 * The reason vocabulary as a person reads it.
 *
 * The host answers a refusal with one of thirteen codes (`packages/host/src/auth/session.ts`), plus
 * `login_not_configured` from `packages/host/src/auth/portal-config.ts`, and the portal sends the
 * browser back to `/sign-in?reason=<code>` carrying the same words. Everything below is about the
 * two things that can go wrong with that: a code nobody wrote copy for, and a `?reason=` somebody
 * typed by hand.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_REASONS,
  authReasonKey,
  authReasonMessage,
  errorCodeFrom,
  isAuthReason,
  LOGIN_NOT_CONFIGURED,
  UNKNOWN_REASON_KEY,
} from "./auth-reason";
import { applyLocale, resetLocaleForTests } from "./i18n";

beforeEach(() => {
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
});

describe("authReasonKey", () => {
  it("maps every code the host can send to its own catalog key", () => {
    expect(authReasonKey("seat_cap_reached")).toBe("auth.reason.seat_cap_reached");
    expect(authReasonKey("refresh_expired")).toBe("auth.reason.refresh_expired");
    expect(authReasonKey(LOGIN_NOT_CONFIGURED)).toBe("auth.reason.login_not_configured");
  });

  it("falls back to one generic key for anything else", () => {
    for (const value of ["not_a_reason", "", "   ", "reason.injected", null, undefined, 7, {}]) {
      expect(authReasonKey(value)).toBe(UNKNOWN_REASON_KEY);
    }
  });

  it("never turns attacker-controlled query text into a key", () => {
    // `?reason=` is whatever was typed in the address bar. It must reach `t()` as a key this module
    // chose, never as text of its own, or the banner renders the visitor's own string.
    expect(authReasonKey("<img src=x onerror=alert(1)>")).toBe(UNKNOWN_REASON_KEY);
    expect(authReasonKey("__proto__")).toBe(UNKNOWN_REASON_KEY);
    expect(authReasonKey("constructor")).toBe(UNKNOWN_REASON_KEY);
  });
});

describe("authReasonMessage", () => {
  it("renders a sentence for every code, in both locales", () => {
    for (const locale of ["en", "id"] as const) {
      resetLocaleForTests();
      applyLocale(locale);
      for (const reason of [...AUTH_REASONS, LOGIN_NOT_CONFIGURED]) {
        const message = authReasonMessage(reason);
        expect(message, `${locale} / ${reason}`).not.toContain("auth.reason.");
        expect(message.length, `${locale} / ${reason}`).toBeGreaterThan(3);
      }
    }
  });

  it("says something generic rather than echoing an unknown code", () => {
    const message = authReasonMessage("wat_is_this");
    expect(message).not.toContain("wat_is_this");
    expect(message).toBe("Sign-in could not be completed. Please try again.");
  });

  it("tells the operator, not the visitor, when the deployment has no login configured", () => {
    expect(authReasonMessage(LOGIN_NOT_CONFIGURED)).toBe(
      "Sign-in is not set up on this deployment. Ask the administrator to finish configuring it.",
    );
  });
});

describe("isAuthReason", () => {
  it("accepts the host's thirteen and nothing else", () => {
    expect(AUTH_REASONS).toHaveLength(13);
    expect(isAuthReason("session_required")).toBe(true);
    // A configuration refusal is renderable copy but it is not a session verdict, so the provider
    // must not store it as one.
    expect(isAuthReason(LOGIN_NOT_CONFIGURED)).toBe(false);
    expect(isAuthReason("nope")).toBe(false);
  });
});

describe("errorCodeFrom", () => {
  it("reads the code out of the host's error envelope", () => {
    expect(errorCodeFrom({ error: { code: "seat_cap_reached", message: "No seats left." } })).toBe(
      "seat_cap_reached",
    );
  });

  it("reads it through the desktop IPC envelope, which nests the body", () => {
    expect(errorCodeFrom({ body: { error: { code: "invalid_request" } } })).toBe("invalid_request");
  });

  it("is null for a body that carries no code", () => {
    for (const body of [null, undefined, {}, { error: "flat" }, { error: { message: "x" } }, "text", 5]) {
      expect(errorCodeFrom(body)).toBeNull();
    }
  });
});
