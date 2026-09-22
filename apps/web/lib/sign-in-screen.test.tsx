/**
 * The sign-in screen, rendered, and the one call behind its button.
 *
 * Two things here are security controls rather than polish, and both have a case of their own: the
 * `?reason=` in the address bar never becomes text (it picks a catalog key or it picks the generic
 * one), and the `authorizeUrl` the host hands back is navigated to only after it has been proved an
 * absolute http(s) URL. A `javascript:` URL in that field would be a redirect straight into script
 * execution on our own origin.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRODUCT_NAME } from "@agentforge/core/gateway";
import { applyLocale, resetLocaleForTests } from "./i18n";
import { ProductBrandProvider } from "./product-brand";
import { safeAuthorizeUrl, SignInScreen, START_PATH, startSignIn } from "@/components/sign-in-screen";

vi.mock("@/lib/api-client", () => ({
  isElectron: () => false,
  apiFetch: (path: string, init?: { method?: string }) => fetched(path, init),
}));

let calls: Array<{ path: string; method: string }> = [];
let reply: { status: number; body: unknown } | "throw" = { status: 200, body: {} };

async function fetched(path: string, init?: { method?: string }): Promise<Response> {
  calls.push({ path, method: init?.method ?? "GET" });
  if (reply === "throw") {
    throw new Error("offline");
  }
  const answer = reply;
  return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
}

function render(url = "/sign-in"): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <ProductBrandProvider>
        <SignInScreen />
      </ProductBrandProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: {} };
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
});

describe("SignInScreen", () => {
  it("offers exactly one way in and says there is no password", () => {
    const markup = render();
    expect(markup).toContain('data-testid="auth-signin"');
    expect(markup).toContain('data-testid="auth-signin-start"');
    expect(markup).toContain("No password");
    expect(markup).toContain("we email you a code");
    // One primary action. A second door on this screen is a second thing to get wrong.
    expect(markup.match(/data-testid="auth-signin-start"/g)).toHaveLength(1);
  });

  it("names the product rather than leaving the placeholder in", () => {
    const markup = render();
    expect(markup).not.toContain("{productName}");
    expect(markup).toContain(`Sign in to ${DEFAULT_PRODUCT_NAME}`);
    expect(markup).toContain("Sign in to DPSBuddy");
  });

  it("shows no banner when the visitor arrived with nothing to explain", () => {
    expect(render()).not.toContain('data-testid="auth-reason"');
  });

  it("explains a reason the host sent", () => {
    const markup = render("/sign-in?reason=seat_cap_reached");
    expect(markup).toContain('data-testid="auth-reason"');
    expect(markup).toContain("No seats left in your organisation.");
  });

  it("tells the operator when the deployment has no login configured", () => {
    const markup = render("/sign-in?reason=login_not_configured");
    expect(markup).toContain('data-testid="auth-reason"');
    expect(markup).toContain("Ask the administrator");
  });

  it("never renders the query string it was handed", () => {
    const markup = render('/sign-in?reason=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
    expect(markup).toContain('data-testid="auth-reason"');
    expect(markup).toContain("Sign-in could not be completed.");
    expect(markup).not.toContain("onerror");
    expect(markup).not.toContain("alert(1)");
    expect(markup).not.toContain("src=x");
    expect(markup).not.toContain("&lt;img");
  });

  it("renders sentences rather than raw catalog keys, in both locales", () => {
    for (const locale of ["en", "id"] as const) {
      resetLocaleForTests();
      applyLocale(locale);
      const markup = render("/sign-in?reason=refresh_expired");
      expect([...markup.matchAll(/auth\.[\w.]+/g)].map((match) => match[0]), locale).toEqual([]);
    }
  });

  it("asks the host for nothing while it is only being looked at", () => {
    render();
    expect(calls).toEqual([]);
  });
});

describe("safeAuthorizeUrl", () => {
  it("accepts the absolute http(s) URL the host builds", () => {
    expect(safeAuthorizeUrl("https://portal.example/authorize?client_id=a&state=b")).toBe(
      "https://portal.example/authorize?client_id=a&state=b",
    );
    // The review instance runs the portal on loopback over plain http.
    expect(safeAuthorizeUrl("http://127.0.0.1:4000/authorize")).toBe("http://127.0.0.1:4000/authorize");
  });

  it("refuses anything that is not an absolute http(s) URL", () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example/authorize",
      "/authorize",
      "authorize",
      "",
      "   ",
      null,
      undefined,
      42,
      { href: "https://portal.example" },
    ]) {
      expect(safeAuthorizeUrl(value), String(value)).toBeNull();
    }
  });
});

describe("startSignIn", () => {
  it("reads the authorize URL off the host's answer", async () => {
    reply = { status: 200, body: { authorizeUrl: "https://portal.example/authorize?state=x" } };
    expect(await startSignIn()).toEqual({ ok: true, url: "https://portal.example/authorize?state=x" });
    expect(calls).toEqual([{ path: START_PATH, method: "GET" }]);
  });

  it("refuses to navigate to a URL that is not absolute http(s)", async () => {
    reply = { status: 200, body: { authorizeUrl: "javascript:alert(1)" } };
    // A 200 is not a permission to navigate anywhere the body says.
    expect(await startSignIn()).toEqual({ ok: false, reason: "portal_unavailable" });
  });

  it("carries the host's code through, so the screen can explain a misconfigured deployment", async () => {
    reply = { status: 503, body: { error: { code: "login_not_configured", message: "…" } } };
    expect(await startSignIn()).toEqual({ ok: false, reason: "login_not_configured" });
  });

  it("reports a host it cannot reach as portal_unavailable", async () => {
    reply = "throw";
    expect(await startSignIn()).toEqual({ ok: false, reason: "portal_unavailable" });
  });

  it("reports a 404 — the answer off a hosted server — as something with copy behind it", async () => {
    reply = { status: 404, body: { error: { code: "not_found", message: "Not found" } } };
    expect(await startSignIn()).toEqual({ ok: false, reason: "not_found" });
  });
});
