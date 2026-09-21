/**
 * The Settings row that says who is signed in.
 *
 * It is mounted on a page every target shows, so the thing to pin hardest is what it does where
 * there is no session concept at all: nothing, with no request behind it. The desk and webdev must
 * not grow an account row that reports an account they do not have.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountSessionRow,
  signOutAndLeave,
  signedOutDestination,
} from "@/components/account-session-row";
import { applyLocale, resetLocaleForTests } from "./i18n";
import { SESSIONS_OFF, SESSION_BOOTING, SessionFixture, type SessionSnapshot } from "./session";

const SIGNED_IN: SessionSnapshot = {
  status: "signed-in",
  identity: {
    userId: "usr_01H8X",
    orgId: "org_kemenkeu",
    tenantId: "tnt_kemenkeu",
    expiresAt: Date.UTC(2026, 8, 21, 9, 30),
  },
  reason: null,
};

function render(value: SessionSnapshot): string {
  return renderToStaticMarkup(
    <SessionFixture value={value}>
      <AccountSessionRow />
    </SessionFixture>,
  );
}

beforeEach(() => {
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
});

describe("AccountSessionRow", () => {
  it("renders nothing where this deployment has no sessions", () => {
    expect(render(SESSIONS_OFF)).toBe("");
  });

  it("renders nothing while the boot read is still in the air", () => {
    expect(render(SESSION_BOOTING)).toBe("");
  });

  it("renders nothing for a visitor who is not signed in", () => {
    expect(render({ status: "signed-out", identity: null, reason: "refresh_expired" })).toBe("");
  });

  it("names who is signed in, and where", () => {
    const markup = render(SIGNED_IN);
    expect(markup).toContain('data-testid="auth-account"');
    expect(markup).toContain("usr_01H8X");
    expect(markup).toContain("org_kemenkeu");
  });

  it("says when the session runs out", () => {
    // The host's idle expiry, in the person's own locale — not a raw epoch on a Settings page.
    const markup = render(SIGNED_IN);
    expect(markup).toContain("2026");
    expect(markup).not.toContain(String(SIGNED_IN.identity?.expiresAt));
  });

  it("offers exactly one way out", () => {
    const markup = render(SIGNED_IN);
    expect(markup.match(/data-testid="auth-signout"/g)).toHaveLength(1);
  });

  it("renders sentences rather than raw catalog keys, in both locales", () => {
    for (const locale of ["en", "id"] as const) {
      resetLocaleForTests();
      applyLocale(locale);
      const markup = render(SIGNED_IN);
      expect([...markup.matchAll(/auth\.[\w.]+/g)].map((match) => match[0]), locale).toEqual([]);
    }
  });
});

const PORTAL_LOGOUT =
  "https://portal.example.test/logout?client_id=cli_abc&post_logout_redirect_uri=https%3A%2F%2Fapp.example.test%2Fsign-in";

describe("signOutAndLeave", () => {
  it("revokes the session first and leaves the app second", async () => {
    const order: string[] = [];
    await signOutAndLeave(
      async () => {
        order.push("logout");
        return null;
      },
      (url) => order.push(`go ${url}`),
    );
    // A navigation before the POST would abort it and leave a live row behind the dead cookie.
    expect(order).toEqual(["logout", "go /sign-in"]);
  });

  it("leaves anyway when the logout call fails", async () => {
    const went: string[] = [];
    await signOutAndLeave(
      async () => {
        throw new Error("offline");
      },
      (url) => went.push(url),
    );
    expect(went).toEqual(["/sign-in"]);
  });

  /**
   * SR-21. Signing out of the app alone left the portal's own 30-day cookie behind, so pressing
   * "Sign in" signed the next person in as the previous one with no e-mail and no code. The host
   * names the portal's `/logout`; this is the hop that goes through it.
   */
  it("goes through the portal's logout when the host named one", async () => {
    const went: string[] = [];
    await signOutAndLeave(async () => ({ signedIn: false, portalLogoutUrl: PORTAL_LOGOUT }), (url) =>
      went.push(url),
    );
    expect(went).toEqual([PORTAL_LOGOUT]);
  });

  it("reads the hop through the host's envelope as well as a flat body", async () => {
    expect(signedOutDestination({ body: { signedIn: false, portalLogoutUrl: PORTAL_LOGOUT } })).toBe(
      PORTAL_LOGOUT,
    );
    expect(signedOutDestination({ signedIn: false, portalLogoutUrl: PORTAL_LOGOUT })).toBe(PORTAL_LOGOUT);
  });

  /**
   * A 200 from our own host is not permission to navigate anywhere its body names — the same rule
   * `safeAuthorizeUrl` applies on the way in, and the reason `location.replace` never sees a
   * `javascript:` value.
   */
  it("falls back to the sign-in screen for anything that is not an absolute http(s) URL", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      "/sign-in",
      "//evil.test/sign-in",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      42,
      { href: "https://evil.test" },
    ]) {
      expect(signedOutDestination({ signedIn: false, portalLogoutUrl: value }), String(value)).toBe(
        "/sign-in",
      );
    }
    expect(signedOutDestination(null)).toBe("/sign-in");
    expect(signedOutDestination({ signedIn: false })).toBe("/sign-in");
  });
});
