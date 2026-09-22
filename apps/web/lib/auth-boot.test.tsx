/**
 * Boot order, and the regression it exists to stop.
 *
 * Before Phase 9 lane C a signed-out visitor to the hosted deployment fell straight through to
 * `resolveGate`, whose answer with no settings payload is `"onboarding"` — so the first thing a
 * person who had never signed in saw was a form asking them to paste a gateway API key
 * (`apps/web/lib/gateway-gate.ts`). That is not a door a tenant has, the key is the operator's, and
 * saving one would have been refused anyway. The rule that replaces it is one function, `bootView`,
 * and the cases below are it: signed out is the sign-in screen and nothing else, and the settings
 * call that produces the gate does not go out at all until there is a session to make it with.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCapabilities } from "@agentforge/core/capabilities";
import { AppRoutes } from "@/src/App";
import { HostCapabilitiesFixture } from "./host-capabilities";
import { applyLocale, resetLocaleForTests } from "./i18n";
import { resetPingForTests } from "./host-ping";
import { PLAN_BLOCK_CODES, type PlanBlockCode } from "./plan-block";
import { bootView, SESSIONS_OFF, SESSION_BOOTING, SessionFixture, type SessionSnapshot } from "./session";

vi.mock("@/lib/api-client", () => ({
  isElectron: () => false,
  apiFetch: (path: string, init?: { method?: string }) => fetched(path, init),
}));

/**
 * The live plan refusal, injected.
 *
 * `usePlanBlock` learns about a refusal from a `window` event raised inside an effect, and
 * `renderToStaticMarkup` runs no effects — so the only way to render this tree *while blocked* is
 * to hand the hook its answer. Everything else in the boundary and the screen is lane G's real
 * code, which is what these cases are about: where the boundary sits, not how it hears.
 */
let planBlock: PlanBlockCode | null = null;

vi.mock("@/lib/plan-block", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plan-block")>()),
  usePlanBlock: () => ({ code: planBlock, clear: () => {} }),
}));

const HOSTED = hostCapabilities({ AGENTFORGE_SERVER: "1" });
const DESK = hostCapabilities({});

let calls: string[] = [];

async function fetched(path: string, init?: { method?: string }): Promise<Response> {
  calls.push(`${init?.method ?? "GET"} ${path}`);
  return { ok: true, status: 200, json: async () => ({}) } as Response;
}

const SIGNED_OUT: SessionSnapshot = { status: "signed-out", identity: null, reason: "session_required" };
const SIGNED_IN: SessionSnapshot = {
  status: "signed-in",
  identity: { userId: "usr_1", orgId: "org_1", tenantId: "tnt_1", expiresAt: 1 },
  reason: null,
};

function render(session: SessionSnapshot, url = "/chat", capabilities = HOSTED): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <HostCapabilitiesFixture capabilities={capabilities}>
        <SessionFixture value={session}>
          <AppRoutes />
        </SessionFixture>
      </HostCapabilitiesFixture>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls = [];
  planBlock = null;
  resetPingForTests();
  applyLocale("en");
});

afterEach(() => {
  resetPingForTests();
  resetLocaleForTests();
});

describe("bootView", () => {
  it("waits while nothing has answered, and only signed out is the sign-in screen", () => {
    expect(bootView("unknown")).toBe("loading");
    expect(bootView("signed-out")).toBe("sign-in");
    expect(bootView("signed-in")).toBe("app");
    // A deployment with no sessions is the desk, unchanged: webdev must not grow a sign-in screen.
    expect(bootView("unavailable")).toBe("app");
  });
});

describe("a signed-out visitor to the hosted app", () => {
  it("gets the sign-in screen, never the paste-your-key onboarding", () => {
    const markup = render(SIGNED_OUT);
    expect(markup).toContain('data-testid="auth-signin"');
    expect(markup).not.toContain('data-testid="onboarding-form"');
    expect(markup).not.toContain('data-testid="onboarding-key"');
  });

  it("gets it on whichever desk URL they arrived at", () => {
    for (const url of ["/chat", "/settings", "/finance", "/does-not-exist"]) {
      expect(render(SIGNED_OUT, url), url).toContain('data-testid="auth-signin"');
    }
  });
});

describe("the boot screen", () => {
  it("is what shows while ping has not answered, on every target", () => {
    for (const capabilities of [HOSTED, DESK]) {
      const markup = render(SESSION_BOOTING, "/chat", capabilities);
      expect(markup).not.toContain('data-testid="auth-signin"');
      expect(markup).not.toContain('data-testid="onboarding-form"');
      expect(markup).toContain("Starting");
    }
  });
});

describe("/sign-in as a route", () => {
  it("is the screen for a signed-out visitor", () => {
    expect(render(SIGNED_OUT, "/sign-in")).toContain('data-testid="auth-signin"');
  });

  it("is nothing at all where this deployment has no sessions", () => {
    // Webdev today sends `/sign-in` to `/chat` through the catch-all. It still does: the route
    // redirects rather than rendering a screen for a sign-in that does not exist here.
    expect(render(SESSIONS_OFF, "/sign-in", DESK)).not.toContain('data-testid="auth-signin"');
  });

  it("does not offer itself to somebody who is already signed in", () => {
    expect(render(SIGNED_IN, "/sign-in")).not.toContain('data-testid="auth-signin"');
  });
});

describe("/auth/callback as a route", () => {
  it("mounts the exchange on the hosted deployment", () => {
    expect(render(SIGNED_OUT, "/auth/callback")).toContain('data-testid="auth-callback"');
  });

  it("never mounts where there is no login to complete", () => {
    // Otherwise a desk that lands here posts to a route its host does not serve.
    expect(render(SESSIONS_OFF, "/auth/callback", DESK)).not.toContain('data-testid="auth-callback"');
  });

  it("waits rather than posting before ping has answered", () => {
    expect(render(SESSION_BOOTING, "/auth/callback")).not.toContain('data-testid="auth-callback"');
  });
});

describe("/pricing as a route", () => {
  it("is reachable signed out, signed in, and on a deployment with no sessions at all", () => {
    // Prices come from the imported catalog, so this page owes nothing to a session — and a
    // `seat_cap_reached` refusal sends people here while they are signed out by definition.
    for (const [session, capabilities] of [
      [SIGNED_OUT, HOSTED],
      [SIGNED_IN, HOSTED],
      [SESSIONS_OFF, DESK],
    ] as const) {
      const markup = render(session, "/pricing", capabilities);
      expect(markup, session.status).toContain('data-testid="pricing-page"');
      expect(markup, session.status).not.toContain('data-testid="auth-signin"');
    }
  });
});

/**
 * Where the plan boundary sits.
 *
 * `renderToStaticMarkup` runs no effects, so the gate never resolves here and the branch inside the
 * boundary is always its first one, the boot screen. That is enough for the question these cases
 * ask, which is not "which screen was replaced" but **which subtrees the boundary is around**: a
 * blocked tenant sees the paywall everywhere behind the session, and nothing in front of it.
 */
describe("a plan refusal", () => {
  it("replaces everything behind the session, with the code it was given", () => {
    planBlock = "plan_past_due";
    const markup = render(SIGNED_IN, "/chat");
    expect(markup).toContain('data-testid="plan-blocked"');
    expect(markup).toContain('data-plan-block="plan_past_due"');
    // Nothing of the boot screen it replaced survives: this is a swap, not an overlay.
    expect(markup).not.toContain("Starting");
  });

  it("never sends a blocked tenant to the paste-your-key onboarding", () => {
    for (const code of PLAN_BLOCK_CODES) {
      planBlock = code;
      const markup = render(SIGNED_IN, "/chat");
      // A hosted tenant holds no gateway key, so that screen has no exit for them
      // (`docs/internal/web-phase5-plans-billing-decisions.md` §3(b)).
      expect(markup, code).not.toContain('data-testid="onboarding-form"');
      expect(markup, code).not.toContain('data-testid="onboarding-key"');
      expect(markup, code).toContain('data-testid="plan-blocked"');
    }
  });

  it("leaves /pricing alone, which is where its own button points", () => {
    planBlock = "plan_allowance_exhausted";
    const markup = render(SIGNED_IN, "/pricing");
    expect(markup).toContain('data-testid="pricing-page"');
    expect(markup).not.toContain('data-testid="plan-blocked"');
  });

  it("leaves the sign-in screen and the callback alone", () => {
    planBlock = "plan_cancelled";
    // Both are reached while signed out; a paywall in front of either is a door that cannot open.
    expect(render(SIGNED_OUT, "/sign-in")).toContain('data-testid="auth-signin"');
    expect(render(SIGNED_OUT, "/sign-in")).not.toContain('data-testid="plan-blocked"');
    expect(render(SIGNED_OUT, "/auth/callback")).toContain('data-testid="auth-callback"');
  });

  it("does not put a paywall in front of a visitor who has not signed in", () => {
    planBlock = "plan_past_due";
    expect(render(SIGNED_OUT, "/chat")).toContain('data-testid="auth-signin"');
    expect(render(SIGNED_OUT, "/chat")).not.toContain('data-testid="plan-blocked"');
  });
});

describe("the desk, unchanged", () => {
  it("renders the shell exactly as it did where there are no sessions", () => {
    const markup = render(SESSIONS_OFF, "/chat", DESK);
    expect(markup).not.toContain('data-testid="auth-signin"');
    expect(markup).not.toContain('data-testid="auth-callback"');
    // Gate still "loading" until the settings effect answers, which is the boot screen it has
    // always shown first.
    expect(markup).toContain("Starting");
  });
});
