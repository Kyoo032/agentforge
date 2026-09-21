import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { WORKSPACE_COOKIE } from "@agentforge/core";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, SESSION_COOKIE_SECURE } from "./auth/session";
import { CSRF_COOKIE, CSRF_COOKIE_SECURE, CSRF_HEADER, csrfSetCookie, mintCsrfToken, mintCsrfTokenFor } from "./csrf";
import { DEFAULT_AUTH_BURST, DEFAULT_IP_BURST, DEFAULT_SESSION_BURST, resetRateLimiters } from "./rate-limit";
import type { HostRequest } from "./types";

// Isolation: nothing in this file may reach the real data/ directory. The router and the boot hook are
// mocked out below so no handler runs, and the data dir is pointed at a temp folder as a second fence.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-http-adapter-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;

const dispatched: HostRequest[] = [];

/** Captures the structured log lines the filter writes, without touching the real console sink. */
const { logged } = vi.hoisted(() => ({
  logged: [] as { level: string; event: string; fields: Record<string, unknown> }[],
}));

vi.mock("./log", () => {
  const record =
    (level: string) =>
    (event: string, fields: Record<string, unknown> = {}): void => {
      logged.push({ level, event, fields });
    };
  const logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
    child: () => logger,
  };
  return { log: logger, createLogger: () => logger };
});

/** Paths the mocked router answers badly on purpose, so the masking rules can be exercised. */
const THROWING_PATH = "/api/v1/boom";
const LEAKY_500_PATH = "/api/v1/leaky";
/** Stands in for a route the session gate refuses; the gate itself lives behind the mocked router. */
const UNAUTHORIZED_PATH = "/api/v1/locked";
const UNAUTHORIZED_CODE = "session_required";
const THROWN_MESSAGE = "ENOENT /data/x";
const LEAKY_MESSAGE = "SQLITE_ERROR: no such column workspaces.secret at /data/agentforge.sqlite";

vi.mock("./router", () => ({
  dispatch: async (request: HostRequest) => {
    dispatched.push(request);
    if (request.path === THROWING_PATH) {
      throw new Error(THROWN_MESSAGE);
    }
    if (request.path === LEAKY_500_PATH) {
      return {
        type: "json" as const,
        status: 500,
        body: { error: { code: "internal_error", message: LEAKY_MESSAGE } },
      };
    }
    if (request.path === UNAUTHORIZED_PATH) {
      return {
        type: "json" as const,
        status: 401,
        body: { error: { code: UNAUTHORIZED_CODE, message: "Sign in to continue" } },
      };
    }
    if (request.path.endsWith("/stream")) {
      return {
        type: "stream" as const,
        status: 200,
        events: (async function* () {
          yield "data: {}\n\n";
        })(),
      };
    }
    return { type: "json" as const, status: 200, body: { ok: true } };
  },
}));

vi.mock("./workspace", () => ({ readSelectedWorkspaceId: () => undefined }));

vi.mock("./handlers/edit", () => ({ handleBootEditJobs: async () => {} }));

const { INTERNAL_ERROR_MESSAGE, handleNodeRequest, maskServerError, writeHostResult } = await import("./http-adapter");

type RequestInput = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /**
   * What the reverse proxy stamped. Caddy sets `X-Forwarded-Proto: https` on every request it
   * forwards, so that is the default here; `null` is the shape of a direct hit on the app's own
   * loopback port, which server mode must refuse.
   */
  forwardedProto?: string | null;
  remoteAddress?: string | null;
};

const TEST_CLIENT_IP = "203.0.113.9";

function fakeRequest({
  method,
  url,
  headers = {},
  body,
  forwardedProto = "https",
  remoteAddress = TEST_CLIENT_IP,
}: RequestInput): IncomingMessage {
  const stream = new PassThrough();
  stream.end(body ? Buffer.from(body, "utf8") : undefined);
  const req = stream as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  const proxied = forwardedProto === null ? {} : { "x-forwarded-proto": forwardedProto };
  req.headers = {
    ...proxied,
    ...Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])),
  };
  Object.defineProperty(req, "socket", { value: { remoteAddress }, configurable: true });
  return req;
}

type Captured = {
  res: ServerResponse;
  status: () => number;
  json: () => { error?: { code?: string; message?: string } };
  header: (name: string) => string | undefined;
  headerValues: (name: string) => string[];
};

function fakeResponse(): Captured {
  const chunks: string[] = [];
  const headers = new Map<string, string[]>();
  const sink = {
    statusCode: 200,
    writableFinished: false,
    setHeader(name: string, value: unknown): void {
      headers.set(name.toLowerCase(), (Array.isArray(value) ? value : [value]).map(String));
    },
    removeHeader(name: string): void {
      headers.delete(name.toLowerCase());
    },
    on(): unknown {
      return sink;
    },
    flushHeaders(): void {},
    write(chunk: unknown): boolean {
      chunks.push(String(chunk));
      return true;
    },
    end(chunk?: unknown): void {
      if (chunk !== undefined) {
        chunks.push(String(chunk));
      }
      sink.writableFinished = true;
    },
  };
  return {
    res: sink as unknown as ServerResponse,
    status: () => sink.statusCode,
    json: () => {
      try {
        return JSON.parse(chunks.join(""));
      } catch {
        return {};
      }
    },
    header: (name: string) => headers.get(name.toLowerCase())?.join(", "),
    headerValues: (name: string) => headers.get(name.toLowerCase()) ?? [],
  };
}

const RESET_PATH = "/api/v1/settings/reset";
const LOOPBACK_HOST = "127.0.0.1:3000";
const TRANSPORT = { "x-agentforge-transport": "web" };

const WEB_ORIGIN = "https://app.dpsbuddy.com";
const WEB_HOST = "app.dpsbuddy.com";
const GATEWAY_CHECK_PATH = "/api/v1/settings/gateway/check";
const SERVER_MODE_KEYS = ["AGENTFORGE_SERVER", "AGENTFORGE_TRUSTED_ORIGINS"] as const;
const savedEnv = new Map<string, string | undefined>();

/**
 * Freezes the clock for one test.
 *
 * The buckets refill on wall time - the per-IP one at 600 rpm is a token every 100 ms - so a test
 * that spends a burst of 100 and expects the next request to be refused is racing the machine it
 * runs on: under load the loop takes long enough to refill one and the refusal never comes. Pinning
 * `Date.now` makes the arithmetic the only thing under test. `vi.restoreAllMocks` in afterEach puts
 * the real clock back; it does not touch the module mocks above, which are not spies.
 */
function freezeClock(): void {
  const frozen = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(frozen);
}

/** Turns the hosted rules on for one test; the afterEach below puts the real env back. */
function useServerMode(trusted = WEB_ORIGIN): void {
  process.env.AGENTFORGE_SERVER = "1";
  process.env.AGENTFORGE_TRUSTED_ORIGINS = trusted;
}

function useLocalMode(): void {
  delete process.env.AGENTFORGE_SERVER;
  delete process.env.AGENTFORGE_TRUSTED_ORIGINS;
}

beforeEach(() => {
  dispatched.length = 0;
  logged.length = 0;
  // The limiters are process-wide; every case starts from full buckets so no test can spend another's.
  resetRateLimiters();
  for (const key of SERVER_MODE_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of SERVER_MODE_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("handleNodeRequest reset-route transport guard", () => {
  it("rejects a form-style POST to the reset route with no transport header", async () => {
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: RESET_PATH,
        headers: { host: LOOPBACK_HOST, "content-type": "application/x-www-form-urlencoded" },
        body: "scope=all&confirm=RESET",
      }),
      captured.res,
    );
    expect(handled).toBe(true);
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a DELETE on the reset route with no transport header", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "DELETE", url: RESET_PATH, headers: { host: LOOPBACK_HOST } }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(dispatched).toHaveLength(0);
  });

  it("passes a JSON POST with the transport header and a loopback Host to the handler", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: RESET_PATH,
        headers: { host: LOOPBACK_HOST, "content-type": "application/json", ...TRANSPORT },
        body: JSON.stringify({ scope: "key" }),
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ method: "POST", path: RESET_PATH, body: { scope: "key" } });
  });

  it("leaves other mutating routes alone when the transport header is missing", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1/settings/gateway/check",
        headers: { host: "localhost:3000" },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });
});

describe("handleNodeRequest Host guard", () => {
  it("rejects a mutating request whose Host is not loopback", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1/settings/gateway/check",
        headers: { host: "attacker.example", ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a mutating request with no Host header at all", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: "/api/v1/settings/gateway/check", headers: TRANSPORT }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(dispatched).toHaveLength(0);
  });

  it("accepts the bracketed IPv6 loopback Host", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: "/api/v1/settings/gateway/check", headers: { host: "[::1]:3000" } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("still rejects a remote Origin on a loopback Host", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1/settings/gateway/check",
        headers: { host: LOOPBACK_HOST, origin: "https://evil.example", ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(dispatched).toHaveLength(0);
  });
});

describe("handleNodeRequest safe methods", () => {
  it("leaves GET untouched by the Host and transport guards", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: `${RESET_PATH}?scope=all`, headers: { host: "attacker.example" } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ method: "GET", path: RESET_PATH, query: { scope: "all" } });
  });

  it("leaves a GET with no Host header untouched", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: "/api/v1/ping" }), captured.res);
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("ignores non-/api paths", async () => {
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({ method: "POST", url: "/not-api", headers: { host: "attacker.example" } }),
      captured.res,
    );
    expect(handled).toBe(false);
    expect(dispatched).toHaveLength(0);
  });
});

describe("writeHostResult content-type sniffing guard", () => {
  it("stamps X-Content-Type-Options: nosniff on the JSON, bytes and SSE branches", async () => {
    const asJson = fakeResponse();
    await writeHostResult(asJson.res, { type: "json", status: 200, body: { ok: true } });
    expect(asJson.header("x-content-type-options")).toBe("nosniff");

    const asBytes = fakeResponse();
    await writeHostResult(asBytes.res, {
      type: "bytes",
      status: 200,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      filename: "shot.png",
    });
    expect(asBytes.header("x-content-type-options")).toBe("nosniff");

    const asStream = fakeResponse();
    await writeHostResult(asStream.res, {
      type: "stream",
      status: 200,
      events: (async function* () {
        yield "data: {}\n\n";
      })(),
    });
    expect(asStream.header("x-content-type-options")).toBe("nosniff");
  });
});

describe("handleNodeRequest web origin rule (server mode)", () => {
  const token = mintCsrfToken();
  const webHeaders = {
    host: WEB_HOST,
    origin: WEB_ORIGIN,
    cookie: `${CSRF_COOKIE_SECURE}=${token}`,
    [CSRF_HEADER]: token,
    ...TRANSPORT,
  };

  it("accepts a mutating call from a trusted origin on the matching Host", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: webHeaders }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("rejects an unlisted origin with origin_forbidden", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { ...webHeaders, origin: "https://evil.example" },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("origin_forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a missing Origin, which the loopback rule still allows", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { host: WEB_HOST, cookie: `${CSRF_COOKIE_SECURE}=${token}`, [CSRF_HEADER]: token, ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("origin_forbidden");
    expect(dispatched).toHaveLength(0);

    useLocalMode();
    const local = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST, ...TRANSPORT } }),
      local.res,
    );
    expect(local.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("rejects a Host header that is not one of the trusted origins", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { ...webHeaders, host: "attacker.example" } }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("origin_forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("rejects the loopback origin once the server is configured for a public origin", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { ...webHeaders, host: LOOPBACK_HOST, origin: "http://127.0.0.1:3000" },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("origin_forbidden");
  });
});

describe("handleNodeRequest CSRF double submit (server mode)", () => {
  const token = mintCsrfToken();

  it("rejects a mutating call with no token at all as csrf_missing", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { host: WEB_HOST, origin: WEB_ORIGIN, ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("csrf_missing");
    expect(dispatched).toHaveLength(0);
  });

  it("rejects a header sent without the cookie as csrf_missing", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { host: WEB_HOST, origin: WEB_ORIGIN, [CSRF_HEADER]: token, ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("csrf_missing");
  });

  it("rejects a token minted for another session as csrf_invalid", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: {
          host: WEB_HOST,
          origin: WEB_ORIGIN,
          cookie: `${CSRF_COOKIE_SECURE}=${token}`,
          [CSRF_HEADER]: mintCsrfToken(),
          ...TRANSPORT,
        },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("csrf_invalid");
    expect(dispatched).toHaveLength(0);
  });

  it("leaves mutating calls alone off server mode, with no token anywhere", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });
});

describe("handleNodeRequest CSRF cookie minting", () => {
  it("mints the cookie on a GET that carries none, readable by the renderer", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: "/api/v1/ping" }), captured.res);
    const cookie = captured.headerValues("set-cookie").find((value) => value.startsWith(`${CSRF_COOKIE}=`));
    expect(cookie).toBeDefined();
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("HttpOnly");
    expect(cookie).not.toContain("Secure");
    expect(captured.status()).toBe(200);
  });

  it("mints the __Host- prefixed, Secure cookie in server mode", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: "/api/v1/ping" }), captured.res);
    const cookie = captured.headerValues("set-cookie").find((value) => value.startsWith(`${CSRF_COOKIE_SECURE}=`));
    expect(cookie).toContain("; Secure");
    expect(cookie).toContain("Path=/");
    expect(cookie?.toLowerCase()).not.toContain("domain=");
  });

  it("re-mints in server mode when only the unprefixed cookie is present", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: "/api/v1/ping", headers: { cookie: `${CSRF_COOKIE}=${mintCsrfToken()}` } }),
      captured.res,
    );
    expect(captured.headerValues("set-cookie").some((value) => value.startsWith(`${CSRF_COOKIE_SECURE}=`))).toBe(true);
  });

  // Phase 3 lane C: the token is bound to a session id, so a cookie that no longer verifies has to
  // be replaced or every mutating call 403s with nothing able to fix it.
  it("re-mints when the cookie was minted before this browser signed in", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "GET",
        url: "/api/v1/ping",
        headers: { cookie: `${CSRF_COOKIE_SECURE}=${mintCsrfTokenFor(null)}; ${SESSION_COOKIE_SECURE}=sid-1` },
      }),
      captured.res,
    );
    expect(captured.headerValues("set-cookie").some((value) => value.startsWith(`${CSRF_COOKIE_SECURE}=`))).toBe(true);
  });

  it("re-mints when the cookie belongs to a different session", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "GET",
        url: "/api/v1/ping",
        headers: { cookie: `${CSRF_COOKIE_SECURE}=${mintCsrfTokenFor("sid-other")}; ${SESSION_COOKIE_SECURE}=sid-1` },
      }),
      captured.res,
    );
    expect(captured.headerValues("set-cookie").some((value) => value.startsWith(`${CSRF_COOKIE_SECURE}=`))).toBe(true);
  });

  it("leaves a cookie that is already bound to this session alone", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "GET",
        url: "/api/v1/ping",
        headers: { cookie: `${CSRF_COOKIE_SECURE}=${mintCsrfTokenFor("sid-1")}; ${SESSION_COOKIE_SECURE}=sid-1` },
      }),
      captured.res,
    );
    expect(captured.headerValues("set-cookie").some((value) => value.startsWith(`${CSRF_COOKIE_SECURE}=`))).toBe(false);
  });

  it("does not re-mint when the request already carries a token", async () => {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: "/api/v1/ping", headers: { cookie: `${CSRF_COOKIE}=${mintCsrfToken()}` } }),
      captured.res,
    );
    expect(captured.headerValues("set-cookie")).toHaveLength(0);
  });

  it("does not mint on a mutating call", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST } }),
      captured.res,
    );
    expect(captured.headerValues("set-cookie")).toHaveLength(0);
  });
});

describe("writeHostResult cookie attributes", () => {
  it("keeps the workspace cookie strict and HttpOnly next to the readable CSRF cookie", async () => {
    const captured = fakeResponse();
    await writeHostResult(
      captured.res,
      {
        type: "json",
        status: 200,
        body: { ok: true },
        cookies: [{ name: WORKSPACE_COOKIE, value: "desk-1", path: "/" }],
      },
      [csrfSetCookie("token-1", { secure: false })],
    );
    const values = captured.headerValues("set-cookie");
    expect(values).toHaveLength(2);
    const workspace = values.find((value) => value.startsWith(`${WORKSPACE_COOKIE}=`));
    const csrf = values.find((value) => value.startsWith(`${CSRF_COOKIE}=`));
    expect(workspace).toContain("SameSite=Strict");
    expect(workspace).toContain("HttpOnly");
    expect(csrf).toContain("SameSite=Lax");
    expect(csrf).not.toContain("HttpOnly");
    expect(WORKSPACE_COOKIE).not.toBe(CSRF_COOKIE);
  });
});

describe("writeHostResult honours per-cookie attributes", () => {
  it("serialises sameSite, secure, httpOnly and maxAge when a handler sets them", async () => {
    const captured = fakeResponse();
    await writeHostResult(captured.res, {
      type: "json",
      status: 200,
      body: { ok: true },
      cookies: [
        {
          name: "agentforge_session",
          value: "abc",
          path: "/",
          sameSite: "Lax",
          secure: true,
          httpOnly: true,
          maxAge: 3600,
        },
        { name: "gone", value: "", path: "/", sameSite: "Lax", maxAge: 0 },
      ],
    });
    const [session, gone] = captured.headerValues("set-cookie");
    expect(session).toBe("agentforge_session=abc; Path=/; Max-Age=3600; SameSite=Lax; HttpOnly; Secure");
    expect(gone).toBe("gone=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly");
  });
});

describe("handleNodeRequest forwards the raw cookie header", () => {
  it("puts the cookie header on request.headers so session routes can read it", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: "/api/v1/ping", headers: { cookie: "agentforge_session=s1; other=2" } }),
      captured.res,
    );
    expect(dispatched[0]?.headers.cookie).toBe("agentforge_session=s1; other=2");
  });
});

describe("handleNodeRequest path normalisation", () => {
  // `dispatch` strips trailing slashes before it matches a route (router.ts), so a guard keyed on the
  // exact path would be one "/" away from being skipped while the handler still ran.
  const RESET_SPELLINGS = [
    `${RESET_PATH}/`,
    `${RESET_PATH}//`,
    "/api/v1//settings/reset",
    "/api/v1/settings//reset/",
  ] as const;

  it("applies the transport rule to every spelling of the reset path", async () => {
    useLocalMode();
    for (const url of RESET_SPELLINGS) {
      const captured = fakeResponse();
      await handleNodeRequest(
        fakeRequest({
          method: "POST",
          url,
          headers: { host: LOOPBACK_HOST, "content-type": "application/x-www-form-urlencoded" },
          body: "scope=all&confirm=RESET",
        }),
        captured.res,
      );
      expect(captured.status(), url).toBe(403);
      expect(captured.json().error?.message, url).toContain("x-agentforge-transport");
    }
    expect(dispatched).toHaveLength(0);
  });

  it("hands the normalised path to the router, so no handler sees the extra slashes", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1//settings/reset/?scope=key",
        headers: { host: LOOPBACK_HOST, "content-type": "application/json", ...TRANSPORT },
        body: JSON.stringify({ scope: "key" }),
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched[0]).toMatchObject({ path: RESET_PATH, query: { scope: "key" } });
  });

  it("applies the CSRF rule to a trailing-slash path in server mode", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: `${GATEWAY_CHECK_PATH}/`,
        headers: { host: WEB_HOST, origin: WEB_ORIGIN, ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("csrf_missing");
    expect(dispatched).toHaveLength(0);
  });

  it("applies the Origin rule to a double-slash path in server mode", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: "/api/v1//settings/gateway/check",
        headers: { host: WEB_HOST, origin: "https://evil.example", ...TRANSPORT },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("origin_forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("uppercases the method, so a lowercase safe verb is not mistaken for a mutating one", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "get", url: "/api/v1/ping", headers: { host: "attacker.example" } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched[0]).toMatchObject({ method: "GET" });
  });
});

describe("handleNodeRequest behind a TLS-terminating proxy (server mode)", () => {
  // The deployment shape in webapp-deploy/Caddyfile: Caddy terminates TLS and forwards the ORIGINAL
  // Host. Rewriting it to 127.0.0.1 (what the old loopback rule needed) now fails the Host check.
  const PUBLIC_ORIGIN = "https://dpsbuddy.example.com";
  const PUBLIC_HOST = "dpsbuddy.example.com";
  const token = mintCsrfToken();
  const proxied = {
    origin: PUBLIC_ORIGIN,
    cookie: `${CSRF_COOKIE_SECURE}=${token}`,
    [CSRF_HEADER]: token,
    ...TRANSPORT,
  };

  it("accepts a write when the proxy passes the public Host through unchanged", async () => {
    useServerMode(PUBLIC_ORIGIN);
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { ...proxied, host: PUBLIC_HOST } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("rejects the same write when the proxy rewrites Host to 127.0.0.1", async () => {
    useServerMode(PUBLIC_ORIGIN);
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { ...proxied, host: "127.0.0.1" } }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("origin_forbidden");
    expect(dispatched).toHaveLength(0);
  });

  it("accepts the public Host spelled with its default port", async () => {
    useServerMode(PUBLIC_ORIGIN);
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { ...proxied, host: `${PUBLIC_HOST}:443` } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
  });

  it("accepts an Origin that spells out the default port the allowlist omits", async () => {
    useServerMode(PUBLIC_ORIGIN);
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { ...proxied, host: PUBLIC_HOST, origin: `${PUBLIC_ORIGIN}:443` },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
  });

  it("accepts an upper-case Host, which the wire format allows", async () => {
    useServerMode(PUBLIC_ORIGIN);
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { ...proxied, host: PUBLIC_HOST.toUpperCase() },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
  });

  it("rejects a trailing-dot Host, which is a different name to this check", async () => {
    useServerMode(PUBLIC_ORIGIN);
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { ...proxied, host: `${PUBLIC_HOST}.` } }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("origin_forbidden");
    expect(dispatched).toHaveLength(0);
  });
});

describe("handleNodeRequest malformed Cookie header", () => {
  const token = mintCsrfToken();

  it("treats a cookie with a broken percent escape as absent instead of throwing", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: {
          host: WEB_HOST,
          origin: WEB_ORIGIN,
          cookie: `broken=%; ${CSRF_COOKIE_SECURE}=${token}`,
          [CSRF_HEADER]: token,
          ...TRANSPORT,
        },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });

  it("answers 403 csrf_missing, not 500, when the CSRF cookie itself is malformed", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: {
          host: WEB_HOST,
          origin: WEB_ORIGIN,
          cookie: `${CSRF_COOKIE_SECURE}=%E0%A4%A`,
          [CSRF_HEADER]: token,
          ...TRANSPORT,
        },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("csrf_missing");
  });

  it("still answers a GET that carries a malformed cookie, and mints a fresh token", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: "/api/v1/ping", headers: { cookie: "junk=%zz" } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(captured.headerValues("set-cookie").some((value) => value.startsWith(`${CSRF_COOKIE}=`))).toBe(true);
  });
});

describe("handleNodeRequest multipart uploads and SSE (server mode)", () => {
  const token = mintCsrfToken();
  const BOUNDARY = "----agentforgeTestBoundary";
  const UPLOAD_PATH = "/api/v1/data/upload";
  const multipartBody = [
    `--${BOUNDARY}`,
    'Content-Disposition: form-data; name="file"; filename="rows.csv"',
    "Content-Type: text/csv",
    "",
    "a,b",
    `--${BOUNDARY}--`,
    "",
  ].join("\r\n");
  const multipartHeaders = {
    host: WEB_HOST,
    origin: WEB_ORIGIN,
    "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
    ...TRANSPORT,
  };

  it("carries a multipart POST through the origin and CSRF rules to the handler", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: UPLOAD_PATH,
        headers: { ...multipartHeaders, cookie: `${CSRF_COOKIE_SECURE}=${token}`, [CSRF_HEADER]: token },
        body: multipartBody,
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.files?.[0]).toMatchObject({ field: "file", filename: "rows.csv", mime: "text/csv" });
    expect(dispatched[0]?.files?.[0]?.bytes.toString()).toBe("a,b");
  });

  it("rejects a multipart POST with no CSRF token before the body is parsed", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: UPLOAD_PATH, headers: multipartHeaders, body: multipartBody }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("csrf_missing");
    expect(dispatched).toHaveLength(0);
  });

  it("streams an SSE GET from any origin; a cross-site read is stopped by the absent CORS header", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "GET",
        url: "/api/v1/jobs/job-1/stream",
        headers: { host: WEB_HOST, origin: "https://evil.example" },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(captured.header("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(captured.header("access-control-allow-origin")).toBeUndefined();
    expect(captured.headerValues("set-cookie").some((value) => value.startsWith(`${CSRF_COOKIE_SECURE}=`))).toBe(true);
  });
});

describe("handleNodeRequest HTTPS only (server mode)", () => {
  const token = mintCsrfToken();
  const write = { origin: WEB_ORIGIN, host: WEB_HOST, cookie: `${CSRF_COOKIE_SECURE}=${token}`, [CSRF_HEADER]: token };

  it("refuses a request the proxy did not mark as https", async () => {
    useServerMode();
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: WEB_HOST }, forwardedProto: null }),
      captured.res,
    );
    expect(handled).toBe(true);
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("https_required");
    expect(dispatched).toHaveLength(0);
  });

  it("refuses a cleartext hop, however it is spelled", async () => {
    useServerMode();
    for (const proto of ["http", "HTTP", "ws", " http "]) {
      const captured = fakeResponse();
      await handleNodeRequest(
        fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: WEB_HOST }, forwardedProto: proto }),
        captured.res,
      );
      expect(captured.json().error?.code).toBe("https_required");
    }
    expect(dispatched).toHaveLength(0);
  });

  it("accepts the https hop, in either case, and reads only the first one", async () => {
    useServerMode();
    for (const proto of ["https", "HTTPS", "https, http"]) {
      const captured = fakeResponse();
      await handleNodeRequest(
        fakeRequest({
          method: "POST",
          url: GATEWAY_CHECK_PATH,
          headers: { ...write, ...TRANSPORT },
          forwardedProto: proto,
        }),
        captured.res,
      );
      expect(captured.status()).toBe(200);
    }
    expect(dispatched).toHaveLength(3);
  });

  it("is checked before the Origin rule, so a plaintext hit never reveals the allowlist", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "POST", url: GATEWAY_CHECK_PATH, headers: { host: "evil.example" }, forwardedProto: null }),
      captured.res,
    );
    expect(captured.json().error?.code).toBe("https_required");
  });

  it("ignores the header entirely off server mode, where webdev speaks http", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST }, forwardedProto: null }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(dispatched).toHaveLength(1);
  });
});

describe("handleNodeRequest HTTP filtering (server mode)", () => {
  const token = mintCsrfToken();
  const write = {
    origin: WEB_ORIGIN,
    host: WEB_HOST,
    cookie: `${CSRF_COOKIE_SECURE}=${token}`,
    [CSRF_HEADER]: token,
    ...TRANSPORT,
  };

  async function send(input: Parameters<typeof fakeRequest>[0]) {
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest(input), captured.res);
    return captured;
  }

  it("answers 405 method_not_allowed for TRACE and TRACK", async () => {
    useServerMode();
    for (const method of ["TRACE", "TRACK"]) {
      const captured = await send({ method, url: GATEWAY_CHECK_PATH, headers: { host: WEB_HOST } });
      expect(captured.status()).toBe(405);
      expect(captured.json().error?.code).toBe("method_not_allowed");
    }
    expect(dispatched).toHaveLength(0);
  });

  it("answers 400 invalid_path for traversal, control bytes and encoded separators", async () => {
    useServerMode();
    // A traversal that climbs OUT of /api (`/api/../x`) is collapsed by the URL parser before this
    // adapter is asked, so it is never an /api request in the first place; these are the spellings
    // that do arrive here.
    for (const url of [`${GATEWAY_CHECK_PATH}/..`, "/api/v1/ch%00at", "/api/v1%2fchat", "/api/v1/ch\\at"]) {
      const captured = await send({ method: "GET", url, headers: { host: WEB_HOST } });
      expect(captured.status()).toBe(400);
      expect(captured.json().error?.code).toBe("invalid_path");
    }
    expect(dispatched).toHaveLength(0);
  });

  it("answers 400 too_many_query_params past the cap", async () => {
    useServerMode();
    const many = Array.from({ length: 33 }, (_, i) => `k${i}=1`).join("&");
    const captured = await send({ method: "GET", url: `${GATEWAY_CHECK_PATH}?${many}`, headers: { host: WEB_HOST } });
    expect(captured.status()).toBe(400);
    expect(captured.json().error?.code).toBe("too_many_query_params");
  });

  it("answers 431 header_too_large for one oversized header", async () => {
    useServerMode();
    const captured = await send({
      method: "GET",
      url: GATEWAY_CHECK_PATH,
      headers: { host: WEB_HOST, "x-big": "x".repeat(8 * 1024 + 1) },
    });
    expect(captured.status()).toBe(431);
    expect(captured.json().error?.code).toBe("header_too_large");
  });

  it("answers 413 payload_too_large on the declared length, before a byte is read", async () => {
    useServerMode();
    const captured = await send({
      method: "POST",
      url: GATEWAY_CHECK_PATH,
      headers: { ...write, "content-type": "application/json", "content-length": String(26 * 1024 * 1024 + 1) },
      body: "{}",
    });
    expect(captured.status()).toBe(413);
    expect(captured.json().error?.code).toBe("payload_too_large");
    expect(dispatched).toHaveLength(0);
  });

  it("answers 415 unsupported_media_type for a form post", async () => {
    useServerMode();
    const captured = await send({
      method: "POST",
      url: GATEWAY_CHECK_PATH,
      headers: { ...write, "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(captured.status()).toBe(415);
    expect(captured.json().error?.code).toBe("unsupported_media_type");
    expect(dispatched).toHaveLength(0);
  });

  it("filters before the Origin and CSRF rules", async () => {
    useServerMode();
    const captured = await send({ method: "TRACE", url: GATEWAY_CHECK_PATH, headers: { host: "evil.example" } });
    expect(captured.json().error?.code).toBe("method_not_allowed");
  });

  it("logs every rejection as request_filtered, with no path and no body", async () => {
    useServerMode();
    await send({ method: "TRACE", url: GATEWAY_CHECK_PATH, headers: { host: WEB_HOST } });
    const line = logged.find((entry) => entry.event === "request_filtered");
    expect(line).toBeDefined();
    expect(line?.fields).toMatchObject({
      code: "method_not_allowed",
      method: "TRACE",
      pathLength: GATEWAY_CHECK_PATH.length,
      ip: TEST_CLIENT_IP,
    });
    expect(JSON.stringify(line?.fields)).not.toContain(GATEWAY_CHECK_PATH);
  });

  it("stamps nosniff on a rejection, so no browser sniffs the envelope", async () => {
    useServerMode();
    const captured = await send({ method: "TRACE", url: GATEWAY_CHECK_PATH, headers: { host: WEB_HOST } });
    expect(captured.header("x-content-type-options")).toBe("nosniff");
    expect(captured.header("content-type")).toBe("application/json; charset=utf-8");
  });

  it("does not filter off server mode: webdev keeps every shape it had", async () => {
    useLocalMode();
    const trace = await send({ method: "TRACE", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST } });
    expect(trace.status()).toBe(200);
    const form = await send({
      method: "POST",
      url: GATEWAY_CHECK_PATH,
      headers: { host: LOOPBACK_HOST, "content-type": "application/x-www-form-urlencoded" },
      body: "a=1",
    });
    expect(form.status()).toBe(200);
    expect(dispatched).toHaveLength(2);
  });
});

/**
 * The page and the static assets are the bulk of a hosted server's traffic, and they reach this
 * adapter too (apps/web/server.ts mounts `handleNodeRequest` as its first middleware, above
 * `express.static` and vite). The transport rules that do not depend on being an /api call - the TLS
 * hop, the method allowlist, the path filter, the header-size cap and the per-IP bucket - therefore
 * run for every one of them, before the /api decision. Off server mode not one of them does.
 */
describe("handleNodeRequest transport guard on non-API paths (server mode)", () => {
  const PAGE = "/";
  const ASSET = "/assets/app-3f2a1c.js";

  async function send(input: Parameters<typeof fakeRequest>[0]) {
    const captured = fakeResponse();
    const handled = await handleNodeRequest(fakeRequest(input), captured.res);
    return { ...captured, handled };
  }

  it("refuses a page request the proxy did not mark as https", async () => {
    useServerMode();
    const captured = await send({ method: "GET", url: PAGE, headers: { host: WEB_HOST }, forwardedProto: null });
    expect(captured.handled).toBe(true);
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("https_required");
  });

  it("refuses a static asset the proxy did not mark as https", async () => {
    useServerMode();
    const captured = await send({ method: "GET", url: ASSET, headers: { host: WEB_HOST }, forwardedProto: null });
    expect(captured.handled).toBe(true);
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("https_required");
  });

  it("answers 405 method_not_allowed for TRACE on a page path", async () => {
    useServerMode();
    const captured = await send({ method: "TRACE", url: PAGE, headers: { host: WEB_HOST } });
    expect(captured.handled).toBe(true);
    expect(captured.status()).toBe(405);
    expect(captured.json().error?.code).toBe("method_not_allowed");
  });

  it("answers 400 invalid_path for a traversal outside /api", async () => {
    useServerMode();
    const captured = await send({ method: "GET", url: "/assets/..%2fetc/passwd", headers: { host: WEB_HOST } });
    expect(captured.handled).toBe(true);
    expect(captured.status()).toBe(400);
    expect(captured.json().error?.code).toBe("invalid_path");
  });

  it("answers 431 header_too_large for one oversized header on a page request", async () => {
    useServerMode();
    const captured = await send({
      method: "GET",
      url: PAGE,
      headers: { host: WEB_HOST, "x-big": "x".repeat(8 * 1024 + 1) },
    });
    expect(captured.handled).toBe(true);
    expect(captured.status()).toBe(431);
    expect(captured.json().error?.code).toBe("header_too_large");
  });

  it("counts page requests against the per-IP bucket, so static traffic is not unlimited", async () => {
    useServerMode();
    freezeClock();
    for (let i = 0; i < DEFAULT_IP_BURST; i += 1) {
      const allowed = await send({ method: "GET", url: PAGE, headers: { host: WEB_HOST } });
      expect(allowed.handled).toBe(false);
    }
    const captured = await send({ method: "GET", url: PAGE, headers: { host: WEB_HOST } });
    expect(captured.handled).toBe(true);
    expect(captured.status()).toBe(429);
    expect(captured.json().error?.code).toBe("rate_limited");
    expect(Number(captured.header("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("shares one bucket between page and /api traffic from the same IP", async () => {
    useServerMode();
    freezeClock();
    for (let i = 0; i < DEFAULT_IP_BURST; i += 1) {
      await send({ method: "GET", url: PAGE, headers: { host: WEB_HOST } });
    }
    const captured = await send({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: WEB_HOST } });
    expect(captured.status()).toBe(429);
    expect(dispatched).toHaveLength(0);
  });

  it("hands a clean page request to the web server untouched", async () => {
    useServerMode();
    const captured = await send({ method: "GET", url: PAGE, headers: { host: WEB_HOST } });
    expect(captured.handled).toBe(false);
    expect(captured.header("content-type")).toBeUndefined();
    expect(dispatched).toHaveLength(0);
  });

  it("logs a page refusal as request_filtered, with the length of the path and no path", async () => {
    useServerMode();
    await send({ method: "TRACE", url: ASSET, headers: { host: WEB_HOST } });
    const line = logged.find((entry) => entry.event === "request_filtered");
    expect(line?.fields).toMatchObject({ code: "method_not_allowed", method: "TRACE", pathLength: ASSET.length });
    expect(JSON.stringify(line?.fields)).not.toContain(ASSET);
  });

  it("changes nothing off server mode: webdev and the desktop shell fall straight through", async () => {
    useLocalMode();
    for (let i = 0; i < DEFAULT_IP_BURST + 20; i += 1) {
      const captured = await send({ method: "GET", url: PAGE, headers: { host: LOOPBACK_HOST }, forwardedProto: null });
      expect(captured.handled).toBe(false);
      expect(captured.header("content-type")).toBeUndefined();
    }
    for (const method of ["TRACE", "PROPFIND"]) {
      const captured = await send({ method, url: ASSET, headers: { host: LOOPBACK_HOST }, forwardedProto: null });
      expect(captured.handled).toBe(false);
    }
    expect(logged).toHaveLength(0);
  });
});

describe("handleNodeRequest rate limiting (server mode)", () => {
  const token = mintCsrfToken();

  async function get(url: string, extra: Record<string, string> = {}, ip = TEST_CLIENT_IP) {
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url, headers: { host: WEB_HOST, ...extra }, remoteAddress: ip }),
      captured.res,
    );
    return captured;
  }

  it("answers 429 rate_limited with Retry-After once the per-IP burst is spent", async () => {
    useServerMode();
    freezeClock();
    for (let i = 0; i < DEFAULT_IP_BURST; i += 1) {
      expect((await get(GATEWAY_CHECK_PATH)).status()).toBe(200);
    }
    const captured = await get(GATEWAY_CHECK_PATH);
    expect(captured.status()).toBe(429);
    expect(captured.json().error?.code).toBe("rate_limited");
    expect(Number(captured.header("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(dispatched).toHaveLength(DEFAULT_IP_BURST);
  });

  it("holds the auth routes to a much tighter bucket", async () => {
    useServerMode();
    freezeClock();
    for (let i = 0; i < DEFAULT_AUTH_BURST; i += 1) {
      expect((await get("/api/v1/auth/session")).status()).toBe(200);
    }
    expect((await get("/api/v1/auth/session")).status()).toBe(429);
    // The same client is nowhere near the general burst, so the rest of the app still answers.
    expect((await get(GATEWAY_CHECK_PATH)).status()).toBe(200);
  });

  it("limits one session across changing IPs, keyed on the __Host- cookie the hosted server mints", async () => {
    useServerMode();
    freezeClock();
    // The name matters: server mode mints `__Host-agentforge_session` (auth/session.ts), so keying
    // on the plain name would leave this bucket permanently empty on the one deployment that has it.
    const cookie = { cookie: `${SESSION_COOKIE_SECURE}=one-session-value; ${CSRF_COOKIE_SECURE}=${token}` };
    for (let i = 0; i < DEFAULT_SESSION_BURST; i += 1) {
      expect((await get(GATEWAY_CHECK_PATH, cookie, `198.51.100.${i}`)).status()).toBe(200);
    }
    const captured = await get(GATEWAY_CHECK_PATH, cookie, "198.51.100.250");
    expect(captured.status()).toBe(429);
    expect(captured.json().error?.code).toBe("rate_limited");
  });

  it("ignores the plain cookie name in server mode: no browser there can set it", async () => {
    useServerMode();
    const cookie = { cookie: `${SESSION_COOKIE}=one-session-value; ${CSRF_COOKIE_SECURE}=${token}` };
    for (let i = 0; i < DEFAULT_SESSION_BURST + 5; i += 1) {
      expect((await get(GATEWAY_CHECK_PATH, cookie, `198.51.100.${i}`)).status()).toBe(200);
    }
  });

  it("logs the refusal as request_filtered without the session value", async () => {
    useServerMode();
    freezeClock();
    for (let i = 0; i < DEFAULT_AUTH_BURST + 1; i += 1) {
      await get("/api/v1/auth/session");
    }
    const line = logged.filter((entry) => entry.event === "request_filtered").at(-1);
    expect(line?.fields).toMatchObject({ code: "rate_limited", method: "GET" });
    expect(JSON.stringify(line?.fields)).not.toContain("one-session-value");
  });

  it("does not limit anything off server mode", async () => {
    useLocalMode();
    for (let i = 0; i < DEFAULT_IP_BURST + 20; i += 1) {
      const captured = fakeResponse();
      await handleNodeRequest(
        fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST } }),
        captured.res,
      );
      expect(captured.status()).toBe(200);
    }
  });
});

describe("handleNodeRequest identity masking", () => {
  it("strips Server and X-Powered-By that a framework put on the response", async () => {
    useServerMode();
    const captured = fakeResponse();
    captured.res.setHeader("X-Powered-By", "Express");
    captured.res.setHeader("Server", "Caddy");
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: WEB_HOST } }),
      captured.res,
    );
    expect(captured.header("x-powered-by")).toBeUndefined();
    expect(captured.header("server")).toBeUndefined();
  });

  it("strips them off server mode too: the desktop answer names no framework either", async () => {
    useLocalMode();
    const captured = fakeResponse();
    captured.res.setHeader("X-Powered-By", "Express");
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST } }),
      captured.res,
    );
    expect(captured.header("x-powered-by")).toBeUndefined();
    expect(captured.status()).toBe(200);
  });

  it("turns a thrown Error into a 500 internal_error with fixed text, in server mode", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: THROWING_PATH, headers: { host: WEB_HOST } }),
      captured.res,
    );
    expect(captured.status()).toBe(500);
    const body = captured.json();
    expect(body.error?.code).toBe("internal_error");
    expect(body.error?.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(JSON.stringify(body)).not.toContain("ENOENT");
    expect(JSON.stringify(body)).not.toContain("/data/");
  });

  it("masks a 5xx a handler produced, keeping the code and dropping the detail", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: LEAKY_500_PATH, headers: { host: WEB_HOST } }),
      captured.res,
    );
    expect(captured.status()).toBe(500);
    expect(captured.json().error).toEqual({ code: "internal_error", message: INTERNAL_ERROR_MESSAGE });
    expect(JSON.stringify(captured.json())).not.toContain("SQLITE");
    expect(JSON.stringify(captured.json())).not.toContain("workspaces.secret");
  });

  it("leaves 4xx messages alone: they are the honest reason the caller needs", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "POST",
        url: GATEWAY_CHECK_PATH,
        headers: { host: WEB_HOST, origin: "https://evil.example" },
      }),
      captured.res,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.message).not.toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("keeps the webdev 500 untouched, so a developer still sees the real failure", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: LEAKY_500_PATH, headers: { host: LOOPBACK_HOST } }),
      captured.res,
    );
    expect(captured.status()).toBe(500);
    expect(captured.json().error?.message).toContain("SQLITE_ERROR");
  });

  it("still throws off server mode, so nothing about the webdev error path changes", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await expect(
      handleNodeRequest(
        fakeRequest({ method: "GET", url: THROWING_PATH, headers: { host: LOOPBACK_HOST } }),
        captured.res,
      ),
    ).rejects.toThrow(THROWN_MESSAGE);
  });
});

describe("maskServerError", () => {
  const leaky = {
    type: "json" as const,
    status: 500,
    body: { error: { code: "internal_error", message: "ENOENT /data/agentforge.sqlite" } },
  };

  it("is a no-op off server mode", () => {
    expect(maskServerError(leaky, false)).toBe(leaky);
  });

  it("is a no-op below 500", () => {
    const client = {
      type: "json" as const,
      status: 404,
      body: { error: { code: "not_found", message: "No such job" } },
    };
    expect(maskServerError(client, true)).toBe(client);
  });

  it("is a no-op for bytes and streams, which carry no message to leak", () => {
    const bytes = { type: "bytes" as const, status: 500, contentType: "application/pdf", bytes: new Uint8Array() };
    expect(maskServerError(bytes, true)).toBe(bytes);
  });

  it("keeps a well-formed code and replaces the message", () => {
    expect(maskServerError(leaky, true)).toEqual({
      type: "json",
      status: 500,
      body: { error: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE } },
    });
  });

  it("falls back to internal_error when the code is missing or is not a reason code", () => {
    const odd = { type: "json" as const, status: 503, body: { error: { message: "at /srv/app/dist/server.js:12" } } };
    expect(maskServerError(odd, true)).toEqual({
      type: "json",
      status: 503,
      body: { error: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE } },
    });
    const weird = { type: "json" as const, status: 500, body: { error: { code: "Error: /data/x", message: "x" } } };
    expect(maskServerError(weird, true)).toMatchObject({ body: { error: { code: "internal_error" } } });
  });

  it("drops a body that is not an error envelope at all", () => {
    const raw = { type: "json" as const, status: 500, body: { stack: "at /srv/app/x.js", rows: [1, 2] } };
    expect(maskServerError(raw, true)).toEqual({
      type: "json",
      status: 500,
      body: { error: { code: "internal_error", message: INTERNAL_ERROR_MESSAGE } },
    });
  });
});

/**
 * A05/A09: every answer carries an id the operator can quote, and every refused sign-in leaves one
 * line behind. Before this, a 401 was indistinguishable from a 200 in the logs, so a password-spray
 * or a stolen-cookie replay across a thousand accounts was invisible: the only lines the adapter
 * wrote were for requests the transport filter had already refused, which a real attacker's
 * well-formed request never trips.
 */
describe("request correlation and authentication-failure logging", () => {
  const apiHeaders = { host: WEB_HOST, origin: WEB_ORIGIN, ...TRANSPORT };

  function authLines() {
    return logged.filter((line) => line.event === "auth_failed");
  }

  it("stamps X-Request-Id on the answer in server mode", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: apiHeaders }), captured.res);
    expect(captured.status()).toBe(200);
    expect(captured.header("X-Request-Id")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("stamps a different id on each request, so two reports cannot be confused", async () => {
    useServerMode();
    const ids = new Set<string | undefined>();
    for (let i = 0; i < 5; i += 1) {
      const captured = fakeResponse();
      await handleNodeRequest(
        fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: apiHeaders }),
        captured.res,
      );
      ids.add(captured.header("X-Request-Id"));
    }
    expect(ids.size).toBe(5);
  });

  it("sends no request id off server mode, so the desktop's responses are unchanged", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: { host: LOOPBACK_HOST, ...TRANSPORT } }),
      captured.res,
    );
    expect(captured.status()).toBe(200);
    expect(captured.header("X-Request-Id")).toBeUndefined();
  });

  it("writes one warn line for a 401, carrying the reason code and the caller's IP", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: UNAUTHORIZED_PATH, headers: apiHeaders }), captured.res);
    expect(captured.status()).toBe(401);
    const lines = authLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("warn");
    expect(lines[0].fields).toMatchObject({
      code: UNAUTHORIZED_CODE,
      method: "GET",
      ip: TEST_CLIENT_IP,
      pathLength: UNAUTHORIZED_PATH.length,
    });
  });

  it("ties the logged line to the id the caller was given", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: UNAUTHORIZED_PATH, headers: apiHeaders }), captured.res);
    expect(authLines()[0].fields.requestId).toBe(captured.header("X-Request-Id"));
  });

  it("logs the path's length and never the path, the cookie or the token itself", async () => {
    useServerMode();
    const secret = "s".repeat(43);
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({
        method: "GET",
        url: `${UNAUTHORIZED_PATH}?token=${secret}`,
        headers: { ...apiHeaders, cookie: `${SESSION_COOKIE_SECURE}=${secret}` },
      }),
      captured.res,
    );
    const serialised = JSON.stringify(authLines());
    expect(serialised).not.toContain(secret);
    expect(serialised).not.toContain(UNAUTHORIZED_PATH);
    expect(serialised).not.toContain("cookie");
  });

  it("stays quiet for an answer that is not a 401", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: GATEWAY_CHECK_PATH, headers: apiHeaders }), captured.res);
    expect(captured.status()).toBe(200);
    expect(authLines()).toHaveLength(0);
  });

  it("stays quiet off server mode, where every call is the one local user's", async () => {
    useLocalMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: UNAUTHORIZED_PATH, headers: { host: LOOPBACK_HOST, ...TRANSPORT } }),
      captured.res,
    );
    expect(captured.status()).toBe(401);
    expect(authLines()).toHaveLength(0);
  });
});

/**
 * Phase 8 — `GET /healthz`, the one path outside `/api` this adapter answers.
 *
 * What these have to prove is not that it returns 200 — it is that it returns 200 while telling a
 * stranger nothing, and that it never reaches `dispatch`. The `dispatched` array is the assertion
 * for the second: a liveness probe that showed up there would be a probe inside the session gate.
 */
describe("handleNodeRequest liveness probe", () => {
  const LIVENESS_URL = "/healthz";
  const proxied = { host: WEB_HOST, origin: WEB_ORIGIN, ...TRANSPORT };

  it("answers one word on the hosted server, with no session and no CSRF token", async () => {
    useServerMode();
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({ method: "GET", url: LIVENESS_URL, headers: proxied }),
      captured.res,
    );
    expect(handled).toBe(true);
    expect(captured.status()).toBe(200);
    expect(captured.json()).toEqual({ status: "ok" });
    // The gate lives behind `dispatch`; never arriving there is what keeps this ungated.
    expect(dispatched).toHaveLength(0);
  });

  it("says nothing about the deployment", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: LIVENESS_URL, headers: proxied }), captured.res);
    const payload = JSON.stringify(captured.json());
    // The reconnaissance list from `handlers/health.ts`: a version, a path, a backend, a tenant.
    for (const leak of ["version", "path", "tenant", "cos", "sqlite", "component", "/data", dataDir]) {
      expect(payload.toLowerCase()).not.toContain(leak.toLowerCase());
    }
    expect(Object.keys(captured.json() as Record<string, unknown>)).toEqual(["status"]);
  });

  it("is not cached, so a dead process cannot keep answering through a proxy", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: LIVENESS_URL, headers: proxied }), captured.res);
    expect(captured.header("cache-control")).toBe("no-store");
    expect(captured.header("x-content-type-options")).toBe("nosniff");
  });

  it("answers HEAD with the right Content-Length and no body", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "HEAD", url: LIVENESS_URL, headers: proxied }), captured.res);
    expect(captured.status()).toBe(200);
    // A body on a HEAD answer is a protocol error; the length still has to be the GET's length.
    expect(captured.header("content-length")).toBe(String(Buffer.byteLength(JSON.stringify({ status: "ok" }))));
    expect(captured.json()).toEqual({});
  });

  it("answers off server mode too, so the same healthcheck works against webdev", async () => {
    useLocalMode();
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({ method: "GET", url: LIVENESS_URL, headers: { host: LOOPBACK_HOST } }),
      captured.res,
    );
    expect(handled).toBe(true);
    expect(captured.json()).toEqual({ status: "ok" });
  });

  it("tolerates the trailing slash a healthcheck config tends to grow", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: "/healthz/", headers: proxied }), captured.res);
    expect(captured.json()).toEqual({ status: "ok" });
  });

  it("leaves any other verb to the page server rather than answering it", async () => {
    useServerMode();
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({ method: "POST", url: LIVENESS_URL, headers: proxied, body: "{}" }),
      captured.res,
    );
    // Whatever happens to it, it is not a liveness answer: only GET and HEAD are recognised.
    expect(captured.json()).not.toEqual({ status: "ok" });
    expect(handled === false || captured.status() !== 200).toBe(true);
  });

  it("writes no log line, because it fires every few seconds forever", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: LIVENESS_URL, headers: proxied }), captured.res);
    expect(captured.status()).toBe(200);
    expect(logged).toHaveLength(0);
  });

  it("does not answer a path that merely starts with the probe's name", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(fakeRequest({ method: "GET", url: "/healthz-internal", headers: proxied }), captured.res);
    expect(captured.json()).not.toEqual({ status: "ok" });
  });
});

/**
 * Phase 8 — the probe answers the caller it exists for, and only that rule bends for it.
 *
 * `docker healthcheck` runs inside the container and hits the app's own loopback port; Caddy's
 * upstream probe does the same. Neither stamps `X-Forwarded-Proto`, and a liveness route that
 * refused them could not tell an orchestrator the app is dead while the proxy is up.
 */
describe("handleNodeRequest liveness on the loopback port", () => {
  const LIVENESS_URL = "/healthz";
  /** No proxy header at all: a direct hit on the app's own port, which is the healthcheck's shape. */
  const direct = { host: "127.0.0.1:3000" };

  it("answers a direct hit that carries no X-Forwarded-Proto", async () => {
    useServerMode();
    const captured = fakeResponse();
    const handled = await handleNodeRequest(
      fakeRequest({ method: "GET", url: LIVENESS_URL, headers: direct, forwardedProto: null }),
      captured.res,
    );
    expect(handled).toBe(true);
    expect(captured.status()).toBe(200);
    expect(captured.json()).toEqual({ status: "ok" });
  });

  it("still refuses every other path on that same hop", async () => {
    useServerMode();
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: "/api/v1/settings", headers: direct, forwardedProto: null }),
      captured.res,
    );
    // The carve-out is one path wide. Anything else on a plaintext hop is refused as it always was.
    expect(captured.status()).toBe(403);
    expect(captured.json().error?.code).toBe("https_required");
  });

  it("is still inside the per-IP bucket, so it cannot be used as an unmetered socket", async () => {
    useServerMode();
    freezeClock();
    for (let i = 0; i < DEFAULT_IP_BURST; i += 1) {
      await handleNodeRequest(
        fakeRequest({ method: "GET", url: LIVENESS_URL, headers: direct, forwardedProto: null }),
        fakeResponse().res,
      );
    }
    const captured = fakeResponse();
    await handleNodeRequest(
      fakeRequest({ method: "GET", url: LIVENESS_URL, headers: direct, forwardedProto: null }),
      captured.res,
    );
    // Exempt from the TLS hop only: the bucket, the header cap and the method allowlist still run.
    expect(captured.status()).toBe(429);
  });
});
