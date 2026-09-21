/**
 * The landing strip the portal sends the browser back to.
 *
 * Four things here are load-bearing and each has a case:
 *
 *   1. The authorization code is read once and then removed from the address bar immediately, so it
 *      cannot sit in history or leave on a `Referer`.
 *   2. React StrictMode runs an effect twice in development. Without a guard the second run reads
 *      an address bar that has already been stripped, finds no code, and redirects a browser that
 *      has just signed in successfully back to the sign-in screen. A previous lane lost a day here.
 *   3. Success is a **full page load**, not a router navigation: the CSRF token is bound to the
 *      session id (`packages/host/src/http-adapter.ts`), so the token this page already holds is
 *      the pre-login one and the first mutation after a client-side navigation would answer 403.
 *   4. Every failure carries the host's own code to `/sign-in?reason=…`, where there is copy for it.
 *
 * Case 3's other half — that no router navigation happens — is pinned structurally: the page is
 * rendered here with **no router around it at all**, which a component calling `useNavigate` cannot
 * survive.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocale, resetLocaleForTests } from "./i18n";
import {
  AuthCallbackPage,
  LOGIN_PATH,
  nextLocation,
  readCallbackParams,
  resetCallbackGuardForTests,
  runCallback,
  type CallbackScope,
} from "@/src/pages/auth-callback-page";

vi.mock("@/lib/api-client", () => ({
  isElectron: () => false,
  apiFetch: (path: string, init?: { method?: string; body?: string }) => fetched(path, init),
}));

type Call = { path: string; method: string; body: unknown };

let calls: Call[] = [];
let reply: { status: number; body: unknown } | "throw" = { status: 200, body: { signedIn: true } };

async function fetched(path: string, init?: { method?: string; body?: string }): Promise<Response> {
  calls.push({
    path,
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(init.body) : undefined,
  });
  if (reply === "throw") {
    throw new Error("offline");
  }
  const answer = reply;
  return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
}

let stripped: string[] = [];
let went: string[] = [];

function scope(search: string, pathname = "/auth/callback"): CallbackScope {
  return {
    search,
    pathname,
    stripQuery: (path) => stripped.push(path),
    go: (url) => went.push(url),
  };
}

beforeEach(() => {
  calls = [];
  stripped = [];
  went = [];
  reply = { status: 200, body: { signedIn: true } };
  resetCallbackGuardForTests();
  applyLocale("en");
});

afterEach(() => {
  resetCallbackGuardForTests();
  resetLocaleForTests();
});

describe("readCallbackParams", () => {
  it("reads the code and the state the portal appended", () => {
    expect(readCallbackParams("?code=abc123&state=xyz789")).toEqual({
      code: "abc123",
      state: "xyz789",
      error: null,
    });
  });

  it("reads the portal's refusal instead", () => {
    expect(readCallbackParams("?error=seat_cap_reached&state=xyz")).toEqual({
      code: null,
      state: "xyz",
      error: "seat_cap_reached",
    });
  });

  it("is all null for an address with nothing on it", () => {
    for (const search of ["", "?", "?other=1"]) {
      expect(readCallbackParams(search)).toEqual({ code: null, state: null, error: null });
    }
  });
});

describe("runCallback", () => {
  it("strips the code out of the address bar before it posts anything", async () => {
    await runCallback(scope("?code=abc&state=xyz"));
    // Ordering is the point: the query is gone from history whatever the exchange answers.
    expect(stripped).toEqual(["/auth/callback"]);
    expect(calls).toHaveLength(1);
  });

  it("posts exactly the code and the state, and nothing else", async () => {
    await runCallback(scope("?code=abc&state=xyz"));
    expect(calls).toEqual([{ path: LOGIN_PATH, method: "POST", body: { code: "abc", state: "xyz" } }]);
  });

  it("reloads the whole page onto /chat when the host signed the browser in", async () => {
    await runCallback(scope("?code=abc&state=xyz"));
    expect(went).toEqual(["/chat"]);
  });

  it("runs once however many times the effect fires", async () => {
    const only = scope("?code=abc&state=xyz");
    await Promise.all([runCallback(only), runCallback(only)]);
    // StrictMode's second pass: one exchange, one strip, one navigation. An authorization code is
    // single use, so a second POST would answer `invalid_grant` and undo the first.
    expect(calls).toHaveLength(1);
    expect(stripped).toHaveLength(1);
    expect(went).toEqual(["/chat"]);
  });

  it("sends the person back with the host's reason when the exchange is refused", async () => {
    reply = { status: 403, body: { error: { code: "seat_cap_reached", message: "No seats left." } } };
    await runCallback(scope("?code=abc&state=xyz"));
    expect(calls).toHaveLength(1);
    expect(went).toEqual(["/sign-in?reason=seat_cap_reached"]);
  });

  it("never posts a code the portal already refused", async () => {
    await runCallback(scope("?error=org_past_due&state=xyz"));
    expect(calls).toEqual([]);
    expect(stripped).toEqual(["/auth/callback"]);
    expect(went).toEqual(["/sign-in?reason=org_past_due"]);
  });

  it("refuses a landing with no code or no state without a round trip", async () => {
    for (const search of ["?state=xyz", "?code=abc", ""]) {
      resetCallbackGuardForTests();
      calls = [];
      went = [];
      await runCallback(scope(search));
      expect(calls, search).toEqual([]);
      expect(went, search).toEqual(["/sign-in?reason=invalid_request"]);
    }
  });

  it("reports a host it could not reach rather than claiming a sign-in", async () => {
    reply = "throw";
    await runCallback(scope("?code=abc&state=xyz"));
    expect(went).toEqual(["/sign-in?reason=portal_unavailable"]);
  });

  it("treats a 200 that is not a signed-in answer as a failure", async () => {
    reply = { status: 200, body: { signedIn: false } };
    await runCallback(scope("?code=abc&state=xyz"));
    expect(went).toEqual(["/sign-in?reason=invalid_grant"]);
  });
});

describe("nextLocation", () => {
  it("is the desk after a sign-in and the sign-in screen after a refusal", () => {
    expect(nextLocation({ kind: "signed-in" })).toBe("/chat");
    expect(nextLocation({ kind: "failed", reason: "refresh_expired" })).toBe("/sign-in?reason=refresh_expired");
  });

  it("encodes a reason rather than pasting it into the query", () => {
    expect(nextLocation({ kind: "failed", reason: "a&b=c d" })).toBe("/sign-in?reason=a%26b%3Dc%20d");
  });
});

describe("AuthCallbackPage", () => {
  it("renders a holding screen and needs no router to do it", () => {
    // No `MemoryRouter`: a component reaching for `useNavigate` throws here, which is the pin that
    // the success path is a full page load rather than a client-side route change.
    const markup = renderToStaticMarkup(<AuthCallbackPage />);
    expect(markup).toContain('data-testid="auth-callback"');
    expect([...markup.matchAll(/auth\.[\w.]+/g)].map((match) => match[0])).toEqual([]);
  });
});
