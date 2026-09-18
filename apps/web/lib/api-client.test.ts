import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, readCsrfCookie } from "./api-client";

const CSRF_HEADER = "x-agentforge-csrf";
const TRANSPORT_HEADER = "x-agentforge-transport";
/** The GET the client makes to have the host mint a token when the jar is empty. */
const PING_PATH = "/api/v1/ping";

type FetchCall = { input: string; init: RequestInit };

function stubDocument(cookie: string): void {
  (globalThis as { document?: { cookie: string } }).document = { cookie };
}

function stubFetch(): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    calls.push({ input, init });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

function headerOf(call: FetchCall, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

afterEach(() => {
  vi.unstubAllGlobals();
  (globalThis as { document?: unknown; window?: unknown }).document = undefined;
  (globalThis as { document?: unknown; window?: unknown }).window = undefined;
});

describe("readCsrfCookie", () => {
  it("reads the token out of a cookie jar that holds other cookies too", () => {
    stubDocument("agentforge_workspace=desk-1; agentforge_csrf=tok-123; theme=dark");
    expect(readCsrfCookie()).toBe("tok-123");
  });

  it("percent-decodes the value", () => {
    stubDocument("agentforge_csrf=a%2Fb%2Bc");
    expect(readCsrfCookie()).toBe("a/b+c");
  });

  it("returns null when there is no cookie, no value, or no document at all", () => {
    stubDocument("agentforge_workspace=desk-1");
    expect(readCsrfCookie()).toBeNull();
    stubDocument("agentforge_csrf=");
    expect(readCsrfCookie()).toBeNull();
    stubDocument("");
    expect(readCsrfCookie()).toBeNull();
    (globalThis as { document?: unknown }).document = undefined;
    expect(readCsrfCookie()).toBeNull();
  });

  it("does not match a cookie whose name merely ends with the token name", () => {
    stubDocument("not_agentforge_csrf=other");
    expect(readCsrfCookie()).toBeNull();
  });
});

describe("apiFetch CSRF header", () => {
  it("sends the token on a mutating fetch, next to the transport header", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const calls = stubFetch();
    await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });
    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0], CSRF_HEADER)).toBe("tok-123");
    expect(headerOf(calls[0], TRANSPORT_HEADER)).toBe("web");
  });

  it("keeps the caller's own headers", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const calls = stubFetch();
    await apiFetch("/api/v1/settings/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(headerOf(calls[0], "content-type")).toBe("application/json");
    expect(headerOf(calls[0], CSRF_HEADER)).toBe("tok-123");
  });

  it("sends no CSRF header on a safe method", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const calls = stubFetch();
    await apiFetch("/api/v1/workspaces");
    expect(headerOf(calls[0], CSRF_HEADER)).toBeNull();
    expect(headerOf(calls[0], TRANSPORT_HEADER)).toBeNull();
  });

  it("still sends the mutating call when no cookie has been minted yet", async () => {
    stubDocument("");
    const calls = stubFetch();
    await apiFetch("/api/v1/settings/gateway/check", { method: "DELETE" });
    // One priming GET, then the call itself - with no CSRF header, because nothing was minted.
    expect(calls).toHaveLength(2);
    expect(headerOf(calls[1], CSRF_HEADER)).toBeNull();
    expect(headerOf(calls[1], TRANSPORT_HEADER)).toBe("web");
  });

  it("leaves the Electron IPC branch alone: no fetch, no cookie read", async () => {
    const invoke = vi.fn(async (_payload: { method: string; path: string }) => ({
      type: "json" as const,
      status: 200,
      body: { ok: true },
    }));
    (globalThis as { window?: unknown }).window = { agentforge: { isElectron: true, invoke } };
    stubDocument("agentforge_csrf=tok-123");
    const calls = stubFetch();
    const response = await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });
    expect(calls).toHaveLength(0);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({ method: "POST", path: "/api/v1/settings/gateway/check" });
    expect(Object.keys(invoke.mock.calls[0][0])).not.toContain("headers");
    expect(response.status).toBe(200);
  });
});

describe("readCsrfCookie cookie names", () => {
  it("prefers the __Host- prefixed cookie the hosted server mints", () => {
    stubDocument("__Host-agentforge_csrf=hosted-token; agentforge_csrf=local-token");
    expect(readCsrfCookie()).toBe("hosted-token");
  });

  it("falls back to the plain name webdev and the desktop mint over http", () => {
    stubDocument("agentforge_csrf=local-token");
    expect(readCsrfCookie()).toBe("local-token");
  });
});

describe("apiFetch CSRF priming", () => {
  // The host mints the token on an /api GET only, so the first action after a cold navigation
  // (a deep link straight into a form) would otherwise have no token to echo.
  it("fetches the ping route to obtain a token, then sends the mutating call with it", async () => {
    stubDocument("");
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      calls.push({ input, init });
      if (input === PING_PATH) {
        stubDocument("__Host-agentforge_csrf=fresh-token");
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });

    await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });

    expect(calls.map((call) => call.input)).toEqual([PING_PATH, "/api/v1/settings/gateway/check"]);
    expect(calls[0].init.method ?? "GET").toBe("GET");
    expect(headerOf(calls[1], CSRF_HEADER)).toBe("fresh-token");
    expect(headerOf(calls[1], TRANSPORT_HEADER)).toBe("web");
  });

  it("primes with the caller's credentials, so the Set-Cookie is kept", async () => {
    stubDocument("");
    const calls = stubFetch();
    await apiFetch("/api/v1/settings/reset", { method: "DELETE", credentials: "include" });
    expect(calls[0].input).toBe(PING_PATH);
    expect(calls[0].init.credentials).toBe("include");
  });

  it("does not prime when a token is already in the jar", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const calls = stubFetch();
    await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("/api/v1/settings/gateway/check");
  });

  it("does not prime on a safe method", async () => {
    stubDocument("");
    const calls = stubFetch();
    await apiFetch("/api/v1/workspaces");
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("/api/v1/workspaces");
  });

  it("primes once per call, and still sends when the ping mints nothing", async () => {
    stubDocument("");
    const calls = stubFetch();
    const response = await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });
    expect(calls.map((call) => call.input)).toEqual([PING_PATH, "/api/v1/settings/gateway/check"]);
    expect(headerOf(calls[1], CSRF_HEADER)).toBeNull();
    expect(response.status).toBe(200);
  });

  it("still sends the mutating call when the priming fetch fails", async () => {
    stubDocument("");
    const calls: FetchCall[] = [];
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      calls.push({ input, init });
      if (input === PING_PATH) {
        throw new TypeError("network down");
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const response = await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });
    expect(calls).toHaveLength(2);
    expect(response.status).toBe(200);
  });

  it("does not prime without a document (no browser cookie jar to fill)", async () => {
    (globalThis as { document?: unknown }).document = undefined;
    const calls = stubFetch();
    await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("/api/v1/settings/gateway/check");
  });

  it("does not prime on the Electron IPC branch", async () => {
    const invoke = vi.fn(async (_payload: { method: string; path: string }) => ({
      type: "json" as const,
      status: 200,
      body: { ok: true },
    }));
    (globalThis as { window?: unknown }).window = { agentforge: { isElectron: true, invoke } };
    stubDocument("");
    const calls = stubFetch();
    await apiFetch("/api/v1/settings/gateway/check", { method: "POST" });
    expect(calls).toHaveLength(0);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
