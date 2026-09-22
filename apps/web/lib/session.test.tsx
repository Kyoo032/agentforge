/**
 * The browser session as the renderer holds it.
 *
 * Everything the provider decides is a function here, so it can be driven without a DOM: the boot
 * read (`readSessionOnce`), the answer parser, what a later 401 does to a live session, and the
 * expiry a person reads. The provider itself is those functions plus `useState`, and the screens
 * that consume it are pinned in `auth-boot.test.tsx` and `account-session-row.test.tsx`.
 *
 * The rule that matters most is the first one: on a deployment without sessions this module makes
 * no request at all. Webdev is that deployment, and a stray `GET /api/v1/auth/session` there would
 * answer 404 and put an error in the console of an app that is working perfectly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostCapabilities } from "@agentforge/core/capabilities";
import { errorCodeFrom, isAuthReason } from "./auth-reason";
import { resetPingForTests } from "./host-ping";
import { PLAN_BLOCK_CODES, parsePlanBlocked } from "./plan-block";
import {
  afterSessionLost,
  formatSessionExpiry,
  parseSessionPayload,
  readSessionOnce,
  SESSIONS_OFF,
  SESSION_BOOTING,
  signOutNow,
  type SessionSnapshot,
} from "./session";

vi.mock("@/lib/api-client", () => ({
  isElectron: () => false,
  apiFetch: (path: string, init?: { method?: string }) => fetched(path, init),
}));

const HOSTED = hostCapabilities({ AGENTFORGE_SERVER: "1" });
const DESK = hostCapabilities({});

let calls: Array<{ path: string; method: string }> = [];
let respond: (path: string) => unknown = () => ({});

async function fetched(path: string, init?: { method?: string }): Promise<Response> {
  calls.push({ path, method: init?.method ?? "GET" });
  const payload = respond(path);
  return { ok: true, status: 200, json: async () => payload } as Response;
}

function answers(capabilities: unknown, session: unknown): (path: string) => unknown {
  return (path) => (path === "/api/v1/ping" ? { capabilities } : session);
}

const SUMMARY = {
  signedIn: true,
  userId: "usr_1",
  orgId: "org_1",
  tenantId: "tnt_1",
  expiresAt: 1_800_000_000_000,
};

beforeEach(() => {
  calls = [];
  respond = () => ({});
  resetPingForTests();
});

afterEach(() => {
  resetPingForTests();
});

describe("readSessionOnce", () => {
  it("asks the host nothing at all where there are no sessions", async () => {
    respond = answers(DESK, SUMMARY);
    expect(await readSessionOnce()).toEqual(SESSIONS_OFF);
    // Ping and nothing else. On webdev `/api/v1/auth/session` is not a route.
    expect(calls.map((call) => call.path)).toEqual(["/api/v1/ping"]);
  });

  it("reads the session only after ping has said this deployment has one", async () => {
    respond = answers(HOSTED, SUMMARY);
    const snapshot = await readSessionOnce();
    expect(calls.map((call) => call.path)).toEqual(["/api/v1/ping", "/api/v1/auth/session"]);
    expect(snapshot.status).toBe("signed-in");
    expect(snapshot.identity).toEqual({
      userId: "usr_1",
      orgId: "org_1",
      tenantId: "tnt_1",
      expiresAt: 1_800_000_000_000,
    });
  });

  it("is signed out, with the host's reason, for a visitor whose cookie failed", async () => {
    respond = answers(HOSTED, { signedIn: false, reason: "session_revoked" });
    expect(await readSessionOnce()).toEqual({
      status: "signed-out",
      identity: null,
      reason: "session_revoked",
    });
  });

  it("treats a host it cannot reach as signed out, not as a deployment without sessions", async () => {
    respond = (path) => {
      if (path === "/api/v1/ping") {
        return { capabilities: HOSTED };
      }
      throw new Error("offline");
    };
    // "unavailable" means "this product has no sign-in here", which would open the app. A host that
    // is briefly down must land on the sign-in screen with something to read instead.
    expect(await readSessionOnce()).toEqual({
      status: "signed-out",
      identity: null,
      reason: "portal_unavailable",
    });
  });

  it("is signed out when ping itself failed, because nothing has said sessions exist", async () => {
    respond = () => {
      throw new Error("offline");
    };
    expect(await readSessionOnce()).toEqual(SESSIONS_OFF);
  });
});

describe("parseSessionPayload", () => {
  it("reads the host's signed-in summary", () => {
    expect(parseSessionPayload(SUMMARY)).toEqual({
      status: "signed-in",
      identity: { userId: "usr_1", orgId: "org_1", tenantId: "tnt_1", expiresAt: 1_800_000_000_000 },
      reason: null,
    });
  });

  it("unwraps the desktop IPC envelope", () => {
    expect(parseSessionPayload({ body: SUMMARY }).status).toBe("signed-in");
  });

  it("gives a visitor who never signed in no reason to read", () => {
    expect(parseSessionPayload({ signedIn: false })).toEqual({
      status: "signed-out",
      identity: null,
      reason: null,
    });
  });

  it("drops a reason it does not recognise rather than storing it as a verdict", () => {
    expect(parseSessionPayload({ signedIn: false, reason: "made_up" }).reason).toBeNull();
  });

  it("refuses a signed-in answer that is missing an identifier", () => {
    for (const missing of ["userId", "orgId", "tenantId"] as const) {
      const payload = { ...SUMMARY, [missing]: "" };
      // Half an identity is not an identity: the row this session would write belongs to somebody.
      expect(parseSessionPayload(payload).status, missing).toBe("signed-out");
    }
  });

  it("reads a missing or unreadable expiry as zero rather than refusing the session", () => {
    expect(parseSessionPayload({ ...SUMMARY, expiresAt: "soon" }).identity?.expiresAt).toBe(0);
  });

  it("is signed out for anything that is not an answer", () => {
    for (const payload of [null, undefined, "", 7, [], {}]) {
      expect(parseSessionPayload(payload).status).toBe("signed-out");
    }
  });
});

describe("signOutNow", () => {
  it("posts the logout the host revokes the row on", async () => {
    await signOutNow();
    expect(calls).toEqual([{ path: "/api/v1/auth/logout", method: "POST" }]);
  });

  it("resolves even when the host refuses, because the browser is leaving anyway", async () => {
    respond = () => {
      throw new Error("offline");
    };
    await expect(signOutNow()).resolves.toBeUndefined();
  });
});

describe("afterSessionLost", () => {
  const live: SessionSnapshot = {
    status: "signed-in",
    identity: { userId: "usr_1", orgId: "org_1", tenantId: "tnt_1", expiresAt: 1 },
    reason: null,
  };

  it("drops the identity and keeps the host's reason", () => {
    expect(afterSessionLost(live, "session_required")).toEqual({
      status: "signed-out",
      identity: null,
      reason: "session_required",
    });
  });

  it("ignores a 401 that is not one of the host's reasons", () => {
    // Webdev answers `unauthorized` when the local owner is not ready. That is not a signed-out
    // session and must not become one.
    expect(afterSessionLost(live, "unauthorized")).toBe(live);
    expect(afterSessionLost(live, null)).toBe(live);
  });

  it("leaves a deployment without sessions alone", () => {
    expect(afterSessionLost(SESSIONS_OFF, "session_required")).toBe(SESSIONS_OFF);
    expect(afterSessionLost(SESSION_BOOTING, "session_required")).toBe(SESSION_BOOTING);
  });

  it("is not moved by a plan refusal", () => {
    // A blocked tenant is signed in — that is how the host knows which plan to refuse. Signing
    // them out would send them to the sign-in screen, where signing in again changes nothing and
    // the paywall they actually need is never shown.
    for (const code of PLAN_BLOCK_CODES) {
      expect(afterSessionLost(live, code), code).toBe(live);
    }
  });
});

/**
 * The two whole-app refusals are different screens, and the seam that reads each one must be deaf
 * to the other: a 401 is never a paywall, and a plan block never signs anybody out.
 */
describe("the session seam and the plan seam", () => {
  it("does not read a session 401 as a plan refusal", () => {
    for (const reason of ["session_required", "session_revoked", "refresh_expired", "seat_cap_reached"]) {
      expect(parsePlanBlocked({ error: { code: reason, message: "…" } }), reason).toBeNull();
    }
  });

  it("does not read a plan refusal as a reason to end the session", () => {
    for (const code of PLAN_BLOCK_CODES) {
      // The flat shape the host actually sends, through the code reader the 401 hook uses.
      expect(errorCodeFrom({ error: code, message: "…" }), code).toBeNull();
      expect(isAuthReason(code), code).toBe(false);
    }
  });
});

describe("formatSessionExpiry", () => {
  it("writes the moment in the person's own locale", () => {
    const at = Date.UTC(2026, 8, 21, 9, 30);
    expect(formatSessionExpiry(at, "en")).toContain("2026");
    expect(formatSessionExpiry(at, "id")).toContain("2026");
  });

  it("is null when there is nothing to show", () => {
    for (const value of [0, Number.NaN, -1]) {
      expect(formatSessionExpiry(value, "en")).toBeNull();
    }
  });
});
