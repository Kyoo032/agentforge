/**
 * Per-user locale on the hosted server (Phase 4 follow-through).
 *
 * `localeForRun()` used to fall back to the process's boot locale for every mode except Chat, which
 * set its own run context. On the hosted server the boot locale belongs to nobody in particular, so
 * Documents, Research, Finance, Market, Legal, Meeting and the rest wrote in the install's language
 * instead of the signed-in person's. `dispatch` now sets the request's locale beside the session, so
 * every handler it runs — and everything that handler awaits — reads the right one.
 *
 * Off server mode there is no session and nothing is set: the desktop and webdev keep the frozen
 * boot locale exactly as before.
 */
import type { AppLocale } from "@agentforge/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, createSession } from "./auth/session";
import { createMemorySessionStore } from "./auth/session-store";
import type { HostJsonResult, HostRequest } from "./types";

const T0 = Date.UTC(2026, 8, 23, 9, 0, 0);

const state = vi.hoisted(() => ({
  boot: "id" as string,
  /** The saved locale per portal user id; anyone not listed has never chosen. */
  saved: {} as Record<string, string>,
  failFor: new Set<string>(),
  seen: [] as Array<{ locale: string; tenantId: string | undefined }>,
  userLocaleCalls: [] as Array<{ tenantId: string; userId?: string }>,
  handlerDelayMs: 0,
}));

vi.mock("./locale-boot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./locale-boot")>();
  return { ...actual, getBootLocale: () => state.boot };
});

vi.mock("./settings-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings-store")>();
  return {
    ...actual,
    loadUserLocale: (scope: { tenantId: string; userId?: string }) => {
      state.userLocaleCalls.push({ tenantId: scope.tenantId, userId: scope.userId });
      if (scope.userId && state.failFor.has(scope.userId)) {
        throw new Error("settings payload unreadable");
      }
      return (scope.userId && state.saved[scope.userId]) || "en";
    },
  };
});

/** `GET /api/v1/tools` stands in for any job route: it records the locale a handler would write in. */
vi.mock("./handlers/misc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handlers/misc")>();
  const { localeForRun } = await import("./run-context");
  return {
    ...actual,
    handleGetTools: async (request: HostRequest) => {
      if (state.handlerDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.handlerDelayMs));
      }
      state.seen.push({ locale: localeForRun(), tenantId: request.session?.tenantId });
      return { type: "json", status: 200, body: { tools: [] } };
    },
    handleGetTemplates: async () => ({ type: "json", status: 200, body: { templates: [] } }),
  };
});

const { dispatch } = await import("./router");

afterEach(() => {
  state.boot = "id";
  state.saved = {};
  state.failFor.clear();
  state.seen.length = 0;
  state.userLocaleCalls.length = 0;
  state.handlerDelayMs = 0;
});

function request(sessionId: string | null, path = "/api/v1/tools"): HostRequest {
  return {
    method: "GET",
    path,
    query: {},
    params: {},
    headers: sessionId ? { cookie: `${SESSION_COOKIE}=${sessionId}` } : {},
    // A client-chosen desk: never an input to whose language this is.
    workspaceId: "somebody-elses-desk",
  };
}

async function signedIn(...people: Array<{ tenantId: string; userId: string }>) {
  const store = createMemorySessionStore();
  const sessions = people.map((who) => createSession({ ...who, orgId: `org_${who.tenantId}`, now: T0 }));
  for (const session of sessions) {
    await store.create(session);
  }
  return { store, sessions, options: { serverMode: true, sessionStore: store, now: () => T0 } };
}

describe("dispatch on the hosted server", () => {
  it("runs a handler in the signed-in person's locale, not the install's", async () => {
    state.boot = "en";
    state.saved = { usr_id: "id" };
    const { sessions, options } = await signedIn({ tenantId: "tnt_a", userId: "usr_id" });
    const result = (await dispatch(request(sessions[0].id), options)) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(state.seen).toEqual([{ locale: "id", tenantId: "tnt_a" }]);
  });

  it("gives a person with no saved choice English, not the install's Indonesian", async () => {
    state.boot = "id";
    const { sessions, options } = await signedIn({ tenantId: "tnt_a", userId: "usr_new" });
    await dispatch(request(sessions[0].id), options);
    expect(state.seen.map((entry) => entry.locale)).toEqual(["en"]);
  });

  it("reads the locale from the verified session's tenant and user, never from the request", async () => {
    state.saved = { usr_id: "id" };
    const { sessions, options } = await signedIn({ tenantId: "tnt_a", userId: "usr_id" });
    await dispatch(request(sessions[0].id), options);
    expect(state.userLocaleCalls).toEqual([{ tenantId: "tnt_a", userId: "usr_id" }]);
  });

  it("keeps two people apart when their requests overlap", async () => {
    state.saved = { usr_id: "id", usr_en: "en" };
    state.handlerDelayMs = 5;
    const { sessions, options } = await signedIn(
      { tenantId: "tnt_a", userId: "usr_id" },
      { tenantId: "tnt_b", userId: "usr_en" },
    );
    await Promise.all([dispatch(request(sessions[0].id), options), dispatch(request(sessions[1].id), options)]);
    expect([...state.seen].sort((a, b) => String(a.tenantId).localeCompare(String(b.tenantId)))).toEqual([
      { locale: "id", tenantId: "tnt_a" },
      { locale: "en", tenantId: "tnt_b" },
    ]);
  });

  it("does not read anyone's settings for a handler that never asks for a locale", async () => {
    state.saved = { usr_id: "id" };
    const { sessions, options } = await signedIn({ tenantId: "tnt_a", userId: "usr_id" });
    const result = (await dispatch(request(sessions[0].id, "/api/v1/templates"), options)) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(state.userLocaleCalls).toEqual([]);
  });

  it("still answers when the person's locale cannot be read, in English", async () => {
    state.boot = "id";
    state.failFor.add("usr_broken");
    const { sessions, options } = await signedIn({ tenantId: "tnt_a", userId: "usr_broken" });
    const result = (await dispatch(request(sessions[0].id), options)) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(state.seen.map((entry) => entry.locale)).toEqual(["en"]);
  });
});

describe("dispatch on the desktop and webdev", () => {
  it("keeps the frozen boot locale and never reads a per-user one", async () => {
    state.boot = "id";
    state.saved = { usr_id: "en" };
    const result = (await dispatch(request(null), { serverMode: false })) as HostJsonResult;
    expect(result.status).toBe(200);
    expect(state.seen).toEqual([{ locale: "id" as AppLocale, tenantId: undefined }]);
    expect(state.userLocaleCalls).toEqual([]);
  });
});
