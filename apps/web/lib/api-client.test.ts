import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, readCsrfCookie, subscribeToWrites } from "./api-client";

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

/** A fetch whose answers the test hands out by hand, so calls can overlap. */
type Held = { resolve: (response: Response) => void; reject: (error: unknown) => void; settled: boolean };
const everHeld: Held[] = [];

function heldFetch() {
  const calls: FetchCall[] = [];
  const held: Held[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    calls.push({ input, init });
    return new Promise<Response>((resolve, reject) => {
      const entry: Held = {
        settled: false,
        resolve: (response) => {
          entry.settled = true;
          resolve(response);
        },
        reject: (error) => {
          entry.settled = true;
          reject(error);
        },
      };
      held.push(entry);
      everHeld.push(entry);
    });
  });
  return { calls, held };
}

// The sharing map lives in the module, so a fetch a test never answered would sit in it and be
// joined by the next test. Answer whatever is left before the next test starts.
afterEach(async () => {
  for (const entry of everHeld.splice(0)) {
    if (!entry.settled) {
      entry.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

/** Lets a call that awaits before it reaches `fetch` (the mutating-header step) get there. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("apiFetch shares one in-flight GET", () => {
  it("makes one fetch for two concurrent identical GETs, and each caller can read the body", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const { calls, held } = heldFetch();
    const first = apiFetch("/api/v1/settings");
    const second = apiFetch("/api/v1/settings");
    await tick();
    expect(calls).toHaveLength(1);
    held[0].resolve(json({ hasOpenai: true }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).not.toBe(b);
    expect(await a.json()).toEqual({ hasOpenai: true });
    expect(await b.json()).toEqual({ hasOpenai: true });
  });

  it("makes a new fetch for a GET that starts after the first one settled", async () => {
    const { calls, held } = heldFetch();
    const first = apiFetch("/api/v1/settings");
    await tick();
    held[0].resolve(json({ n: 1 }));
    expect(await (await first).json()).toEqual({ n: 1 });
    const second = apiFetch("/api/v1/settings");
    await tick();
    expect(calls).toHaveLength(2);
    held[1].resolve(json({ n: 2 }));
    expect(await (await second).json()).toEqual({ n: 2 });
  });

  it("does not share across a different path or query string", async () => {
    const { calls } = heldFetch();
    void apiFetch("/api/v1/threads?scope=chat");
    void apiFetch("/api/v1/threads?scope=documents");
    void apiFetch("/api/v1/workspaces");
    await tick();
    expect(calls.map((call) => call.input)).toEqual([
      "/api/v1/threads?scope=chat",
      "/api/v1/threads?scope=documents",
      "/api/v1/workspaces",
    ]);
  });

  it("never shares a write, and never lets a write ride on a read", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const { calls, held } = heldFetch();
    void apiFetch("/api/v1/settings", { method: "POST", body: "{}" });
    void apiFetch("/api/v1/settings", { method: "POST", body: "{}" });
    await tick();
    expect(calls.map((call) => call.init.method)).toEqual(["POST", "POST"]);
    void apiFetch("/api/v1/settings");
    await tick();
    expect(calls).toHaveLength(3);
    for (const entry of held) {
      entry.resolve(json({}));
    }
  });

  it("does not share a GET that carries a signal or any option beyond the method", async () => {
    const { calls } = heldFetch();
    const controller = new AbortController();
    void apiFetch("/api/v1/components", { signal: controller.signal });
    void apiFetch("/api/v1/components", { signal: controller.signal });
    void apiFetch("/api/v1/components", { headers: { Accept: "application/json" } });
    void apiFetch("/api/v1/components", { credentials: "include" });
    await tick();
    expect(calls).toHaveLength(4);
  });

  it("gives every caller the failure, and starts fresh afterwards", async () => {
    const { calls, held } = heldFetch();
    const first = apiFetch("/api/v1/settings");
    const second = apiFetch("/api/v1/settings");
    await tick();
    expect(calls).toHaveLength(1);
    held[0].reject(new TypeError("network down"));
    await expect(first).rejects.toThrow("network down");
    await expect(second).rejects.toThrow("network down");
    const third = apiFetch("/api/v1/settings");
    await tick();
    expect(calls).toHaveLength(2);
    held[1].resolve(json({ ok: true }));
    expect((await third).status).toBe(200);
  });

  it("shares an error status too: both callers see the 503, neither is told it succeeded", async () => {
    const { calls, held } = heldFetch();
    const first = apiFetch("/api/v1/settings");
    const second = apiFetch("/api/v1/settings");
    await tick();
    held[0].resolve(json({ error: "busy" }, 503));
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    expect([a.status, b.status]).toEqual([503, 503]);
    expect(await a.json()).toEqual({ error: "busy" });
    expect(await b.json()).toEqual({ error: "busy" });
  });

  it("does not let a read that started before a write answer a read that starts after it", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const { calls, held } = heldFetch();
    const before = apiFetch("/api/v1/settings");
    const write = apiFetch("/api/v1/settings", { method: "POST", body: "{}" });
    const during = apiFetch("/api/v1/settings");
    await tick();
    // The write reset sharing, so the read that started after it is its own request. (The fetches
    // leave in a different order than the calls were made: a write awaits its CSRF step first.)
    expect(calls.map((call) => call.init.method ?? "GET").sort()).toEqual(["GET", "GET", "POST"]);
    const writeAt = calls.findIndex((call) => call.init.method === "POST");
    held[writeAt].resolve(json({ saved: true }));
    await write;
    // ... and one that starts once the write settled must not join `during` either.
    const after = apiFetch("/api/v1/settings");
    await tick();
    expect(calls).toHaveLength(4);
    held.forEach((entry, index) => {
      if (index !== writeAt) {
        entry.resolve(json({ index }));
      }
    });
    expect((await Promise.all([before, during, after])).map((response) => response.status)).toEqual([200, 200, 200]);
  });

  it("hands a stream to the caller that asked first and gives a joiner its own request", async () => {
    const { calls, held } = heldFetch();
    const first = apiFetch("/api/v1/edit/projects/p1/events");
    const second = apiFetch("/api/v1/edit/projects/p1/events");
    await tick();
    expect(calls).toHaveLength(1);
    held[0].resolve(new Response("data: 1\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    const a = await first;
    expect(await a.text()).toBe("data: 1\n\n");
    // A stream has one reader; the second caller must not be handed a buffered copy of it.
    await tick();
    expect(calls).toHaveLength(2);
    held[1].resolve(new Response("data: 1\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    expect(await (await second).text()).toBe("data: 1\n\n");
  });

  it("gives three concurrent callers three readable bodies", async () => {
    const { calls, held } = heldFetch();
    const all = [apiFetch("/api/v1/workspaces"), apiFetch("/api/v1/workspaces"), apiFetch("/api/v1/workspaces")];
    await tick();
    expect(calls).toHaveLength(1);
    held[0].resolve(json({ desks: 3 }));
    const responses = await Promise.all(all);
    expect(new Set(responses).size).toBe(3);
    for (const response of responses) {
      expect(await response.json()).toEqual({ desks: 3 });
    }
  });

  it("does not join a read that has been in flight for more than two seconds", async () => {
    const { calls, held } = heldFetch();
    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(1_000_000);
      void apiFetch("/api/v1/settings");
      clock.mockReturnValue(1_001_999);
      void apiFetch("/api/v1/settings");
      await tick();
      expect(calls).toHaveLength(1);
      // A hung request must not hold up every later identical read.
      clock.mockReturnValue(1_002_000);
      const late = apiFetch("/api/v1/settings");
      await tick();
      expect(calls).toHaveLength(2);
      held[1].resolve(json({ fresh: true }));
      expect(await (await late).json()).toEqual({ fresh: true });
    } finally {
      clock.mockRestore();
    }
  });

  it("does not let a read that straddles the end of a streamed write answer one that starts after it", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const { calls, held } = heldFetch();
    // A read starts while the run is streaming and is still in flight when the stream ends.
    const run = apiFetch("/api/v1/threads/t1/runs/text", { method: "POST", body: "{}" });
    await tick();
    held[0].resolve(new Response("data: hi\n\n", { headers: { "Content-Type": "text/event-stream" } }));
    const stream = await run;
    void apiFetch("/api/v1/threads/t1");
    await tick();
    expect(calls).toHaveLength(2);
    // The headers arrived and the stream is still open: this read is joining the one above.
    void apiFetch("/api/v1/threads/t1");
    await tick();
    expect(calls).toHaveLength(2);
    expect(await stream.text()).toBe("data: hi\n\n");
    // The stream is over, so what the host saved at its end must be read again, not from the old request.
    const after = apiFetch("/api/v1/threads/t1");
    await tick();
    expect(calls).toHaveLength(3);
    held[1].resolve(json({ stale: true }));
    held[2].resolve(json({ stale: false }));
    expect(await (await after).json()).toEqual({ stale: false });
  });

  it("also ends the streamed write when the caller stops reading at its last event", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const { calls, held } = heldFetch();
    const run = apiFetch("/api/v1/jobs/run", { method: "POST", body: "{}" });
    await tick();
    // An open body that never closes on its own: only a cancel can end it, which is what
    // `runJobStream` does at `job.done` (`reader.cancel()` in its `finally`), so `flush` never runs.
    const open = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: done\n\n"));
      },
    });
    held[0].resolve(new Response(open, { headers: { "Content-Type": "text/event-stream" } }));
    const stream = await run;
    // A read that began during the run, and is still in flight when the caller stops reading.
    void apiFetch("/api/v1/artifacts");
    await tick();
    expect(calls).toHaveLength(2);
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    // What the host saved at the end of the run must be read again, not taken from that old request.
    const after = apiFetch("/api/v1/artifacts");
    await tick();
    expect(calls).toHaveLength(3);
    held[1].resolve(json({ stale: true }));
    held[2].resolve(json({ stale: false }));
    expect(await (await after).json()).toEqual({ stale: false });
  });

  it("leaves a streamed write's status and headers as the caller would have got them", async () => {
    stubDocument("agentforge_csrf=tok-123");
    const { held } = heldFetch();
    const run = apiFetch("/api/v1/threads/t1/runs/text", { method: "POST", body: "{}" });
    await tick();
    held[0].resolve(
      new Response("data: 1\n\ndata: 2\n\n", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/event-stream; charset=utf-8", "x-run": "r1" },
      }),
    );
    const response = await run;
    expect(response.status).toBe(200);
    expect(response.headers.get("x-run")).toBe("r1");
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    const chunks: string[] = [];
    for (;;) {
      const { done, value } = (await reader?.read()) ?? { done: true, value: undefined };
      if (done) {
        break;
      }
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks.join("")).toBe("data: 1\n\ndata: 2\n\n");
  });

  it("shares one IPC call on the desktop too, and never shares a write there", async () => {
    const invoke = vi.fn(async (_payload: { method: string; path: string }) => ({
      type: "json" as const,
      status: 200,
      body: { ok: true },
    }));
    (globalThis as { window?: unknown }).window = { agentforge: { isElectron: true, invoke } };
    const [a, b] = await Promise.all([apiFetch("/api/v1/workspaces"), apiFetch("/api/v1/workspaces")]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await a.json()).toEqual({ ok: true });
    expect(await b.json()).toEqual({ ok: true });
    await Promise.all([
      apiFetch("/api/v1/workspaces/w1/select", { method: "POST" }),
      apiFetch("/api/v1/workspaces/w1/select", { method: "POST" }),
    ]);
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});

describe("subscribeToWrites", () => {
  it("tells a listener when a write starts and again when it is over, and never for a read", async () => {
    stubDocument("agentforge_csrf=tok-123");
    stubFetch();
    const seen: string[] = [];
    const stop = subscribeToWrites(() => seen.push("dropped"));
    try {
      await apiFetch("/api/v1/workspaces");
      expect(seen).toEqual([]);
      await apiFetch("/api/v1/settings", { method: "POST", body: "{}" });
      expect(seen).toEqual(["dropped", "dropped"]);
    } finally {
      stop();
    }
  });

  it("says the write is over when it fails, so a kept answer cannot outlive it", async () => {
    stubDocument("agentforge_csrf=tok-123");
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    const seen: string[] = [];
    const stop = subscribeToWrites(() => seen.push("dropped"));
    try {
      await expect(apiFetch("/api/v1/settings", { method: "POST", body: "{}" })).rejects.toThrow("network down");
      expect(seen).toEqual(["dropped", "dropped"]);
    } finally {
      stop();
    }
  });

  it("tells a listener again when a streamed write body ends", async () => {
    stubDocument("agentforge_csrf=tok-123");
    vi.stubGlobal(
      "fetch",
      async () => new Response("data: hi\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    );
    const seen: string[] = [];
    const stop = subscribeToWrites(() => seen.push("dropped"));
    try {
      const response = await apiFetch("/api/v1/threads/t1/runs/text", { method: "POST", body: "{}" });
      // Once when the write started and once when its headers arrived...
      expect(seen).toEqual(["dropped", "dropped"]);
      await response.text();
      // ...and once more when the stream ends, because the host saves the result there.
      expect(seen).toEqual(["dropped", "dropped", "dropped"]);
    } finally {
      stop();
    }
  });

  it("stops telling a listener that unsubscribed", async () => {
    stubDocument("agentforge_csrf=tok-123");
    stubFetch();
    const seen: string[] = [];
    const stop = subscribeToWrites(() => seen.push("dropped"));
    stop();
    await apiFetch("/api/v1/settings", { method: "POST", body: "{}" });
    expect(seen).toEqual([]);
  });
});
