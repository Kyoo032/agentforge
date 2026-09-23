/**
 * The desk list on the key screen, and the two calls behind it.
 *
 * The key screen replaces the whole shell, so on a desk with no key of its own it used to be a dead
 * end: no rail, no desk switcher, and the only way out was pasting a key into that desk (finding 1
 * of the 0.15.0 verify pass). These pin the way out: the other desks are listed, opening one is the
 * host's select followed by the host's gate for that desk, and a one-desk install shows nothing.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingDesks } from "@/components/onboarding-desks";
import { applyLocale, resetLocaleForTests } from "./i18n";
import { fetchOtherDesks, openDesk, otherDesks } from "./onboarding-desks";

vi.mock("./api-client", () => ({
  isElectron: () => false,
  apiFetch: (path: string, init?: { method?: string }) => fetched(path, init),
}));

type Reply = { status: number; body: unknown };
let calls: Array<{ path: string; method: string }> = [];
let replies: Record<string, Reply> = {};

async function fetched(path: string, init?: { method?: string }): Promise<Response> {
  const method = init?.method ?? "GET";
  calls.push({ path, method });
  const answer = replies[`${method} ${path}`];
  if (!answer) {
    throw new Error("offline");
  }
  return { ok: answer.status < 400, status: answer.status, json: async () => answer.body } as Response;
}

const LIST = {
  workspaces: [
    { id: "ws-home", name: "Default", slug: "home" },
    { id: "ws-legal", name: "Legal", slug: "legal" },
  ],
  currentWorkspaceId: "ws-legal",
};

const OPEN_GATE = {
  status: "ok",
  allowed: true,
  grace: false,
  endpoint: "https://api.tokotokenai.com/v1",
  endpointLocked: true,
  checkedAt: null,
  lastOkAt: null,
};

beforeEach(() => {
  calls = [];
  replies = {};
  applyLocale("en");
});

afterEach(() => {
  resetLocaleForTests();
});

describe("otherDesks", () => {
  it("lists every desk except the current one", () => {
    expect(otherDesks(LIST)).toEqual([{ id: "ws-home", name: "Default" }]);
  });

  it("drops malformed rows and survives a malformed body", () => {
    expect(otherDesks({ workspaces: [null, { id: 3 }, { id: "a" }, { id: "b", name: "B" }] })).toEqual([
      { id: "b", name: "B" },
    ]);
    expect(otherDesks(null)).toEqual([]);
    expect(otherDesks({ workspaces: "nope" })).toEqual([]);
  });
});

describe("fetchOtherDesks", () => {
  it("reads the host's desk list", async () => {
    replies["GET /api/v1/workspaces"] = { status: 200, body: LIST };
    expect(await fetchOtherDesks()).toEqual([{ id: "ws-home", name: "Default" }]);
  });

  it("is an empty list when the host cannot be asked, so the key form still renders", async () => {
    expect(await fetchOtherDesks()).toEqual([]);
    replies["GET /api/v1/workspaces"] = { status: 500, body: {} };
    expect(await fetchOtherDesks()).toEqual([]);
  });
});

describe("openDesk", () => {
  it("selects the desk on the host, then returns the host's gate for it", async () => {
    replies["POST /api/v1/workspaces/ws-home/select"] = { status: 200, body: {} };
    replies["GET /api/v1/settings"] = { status: 200, body: { gateway: OPEN_GATE } };

    const gate = await openDesk("ws-home");

    expect(calls).toEqual([
      { path: "/api/v1/workspaces/ws-home/select", method: "POST" },
      { path: "/api/v1/settings", method: "GET" },
    ]);
    expect(gate?.allowed).toBe(true);
    expect(gate?.status).toBe("ok");
  });

  it("returns null when the host reports no gate, and never invents one", async () => {
    replies["POST /api/v1/workspaces/ws-home/select"] = { status: 200, body: {} };
    replies["GET /api/v1/settings"] = { status: 200, body: {} };
    expect(await openDesk("ws-home")).toBeNull();
  });

  it("throws when the host refuses the select, without asking for a gate", async () => {
    replies["POST /api/v1/workspaces/ws-gone/select"] = { status: 404, body: {} };
    await expect(openDesk("ws-gone")).rejects.toThrow();
    expect(calls.map((call) => call.path)).toEqual(["/api/v1/workspaces/ws-gone/select"]);
  });
});

describe("OnboardingDesks", () => {
  it("renders nothing on a one-desk install", () => {
    expect(renderToStaticMarkup(<OnboardingDesks desks={[]} busy={false} onOpen={() => {}} />)).toBe("");
  });

  it("offers every other desk by name", () => {
    const markup = renderToStaticMarkup(
      <OnboardingDesks desks={[{ id: "ws-home", name: "Default" }]} busy={false} onOpen={() => {}} />,
    );
    expect(markup).toContain('data-testid="onboarding-desks"');
    expect(markup).toContain('data-testid="onboarding-open-desk"');
    expect(markup).toContain('data-workspace-id="ws-home"');
    expect(markup).toContain(">Default</button>");
    expect(markup).toContain("Or open another desk");
    expect(markup).not.toMatch(/onboarding\.desks\./);
  });

  it("speaks Indonesian on an id desk", () => {
    applyLocale("id");
    const markup = renderToStaticMarkup(
      <OnboardingDesks desks={[{ id: "ws-home", name: "Default" }]} busy={false} onOpen={() => {}} />,
    );
    expect(markup).toContain("Atau buka meja lain");
  });

  it("disables the desks while a call is in flight", () => {
    const markup = renderToStaticMarkup(
      <OnboardingDesks desks={[{ id: "ws-home", name: "Default" }]} busy onOpen={() => {}} />,
    );
    expect(markup).toContain("disabled");
  });
});
