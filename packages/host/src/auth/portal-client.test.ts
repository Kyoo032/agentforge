import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PORTAL_AUTHORIZE_PATH,
  PORTAL_TIMEOUT_MS,
  PortalError,
  buildAuthorizeUrl,
  createFakePortalClient,
  createPortalClient,
  portalBaseUrl,
} from "./portal-client";

/**
 * The confidential-client half of the exchange, spread into every call so the wire contract is
 * typed at each one: Phase 9 lane F made `redirect_uri` and the client credentials required
 * arguments rather than optional ones, because an exchange that silently omits them is exactly the
 * unauthenticated fallback the deployment template says never happens.
 */
const EXCHANGE = {
  redirectUri: "https://app.example.test/auth/callback",
  clientId: "cli_abc",
  clientSecret: "sec_xyz",
} as const;

const TOKEN_BODY = {
  access_token: "acc-secret",
  token_type: "Bearer",
  expires_in: 3600,
  refresh_token: "ref-secret",
  refresh_expires_in: 2592000,
  session_id: "ses_1",
  device_id: "dev_1",
  org_id: "org_1",
  user_id: "usr_1",
  tenant_id: "tnt_1",
};

type Call = { url: string; init: RequestInit };

function recordingFetch(response: () => Response): { calls: Call[]; impl: typeof fetch } {
  const calls: Call[] = [];
  const impl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return response();
  }) as typeof fetch;
  return { calls, impl };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const baseUrl = "https://api.tokotokenai.com";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("portalBaseUrl", () => {
  it("reads AGENTFORGE_PORTAL_URL and drops the trailing slash", () => {
    expect(portalBaseUrl({ AGENTFORGE_PORTAL_URL: "https://api.tokotokenai.com/" })).toBe(
      "https://api.tokotokenai.com",
    );
  });

  it("refuses a missing value", () => {
    expect(() => portalBaseUrl({})).toThrow(/AGENTFORGE_PORTAL_URL/);
  });

  it("refuses plain HTTP off loopback", () => {
    expect(() => portalBaseUrl({ AGENTFORGE_PORTAL_URL: "http://portal.example.com" })).toThrow();
    expect(portalBaseUrl({ AGENTFORGE_PORTAL_URL: "http://127.0.0.1:8080" })).toBe("http://127.0.0.1:8080");
  });
});

describe("exchangeCode", () => {
  it("posts the browser code to /auth/token and maps the response", async () => {
    const { calls, impl } = recordingFetch(() => json(TOKEN_BODY));
    const client = createPortalClient({ baseUrl, fetchImpl: impl });
    const tokens = await client.exchangeCode({ code: "K7M4PQ9T", ...EXCHANGE });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.tokotokenai.com/auth/token");
    expect(calls[0].init.method).toBe("POST");
    // The wire contract lane B implements the other side of. Every field, spelled exactly once.
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      grant_type: "authorization_code",
      code: "K7M4PQ9T",
      redirect_uri: "https://app.example.test/auth/callback",
      client_id: "cli_abc",
      client_secret: "sec_xyz",
    });
    expect(tokens).toEqual({
      accessToken: "acc-secret",
      expiresIn: 3600,
      refreshToken: "ref-secret",
      refreshExpiresIn: 2592000,
      sessionId: "ses_1",
      deviceId: "dev_1",
      userId: "usr_1",
      orgId: "org_1",
      tenantId: "tnt_1",
    });
  });

  it("carries a timeout signal on every call", async () => {
    const { calls, impl } = recordingFetch(() => json(TOKEN_BODY));
    await createPortalClient({ baseUrl, fetchImpl: impl }).exchangeCode({ code: "c", ...EXCHANGE });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(PORTAL_TIMEOUT_MS).toBe(5000);
  });

  it("aborts a portal that never answers and reports portal_unavailable", async () => {
    const impl = ((_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const client = createPortalClient({ baseUrl, fetchImpl: impl, timeoutMs: 10 });
    await expect(client.exchangeCode({ code: "c", ...EXCHANGE })).rejects.toMatchObject({
      reason: "portal_unavailable",
      status: 503,
    });
  });

  it("maps a refused sign-in to the portal's own reason code and copy", async () => {
    const body = {
      error: "invalid_grant",
      reason: "seat_cap_reached",
      message_en: "Your organisation has no seats left.",
      message_id: "Organisasi Anda tidak memiliki kursi tersisa.",
      retry_after: 5,
    };
    const client = createPortalClient({ baseUrl, fetchImpl: recordingFetch(() => json(body, 403)).impl });
    const error = await client.exchangeCode({ code: "c", ...EXCHANGE }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PortalError);
    expect(error).toMatchObject({
      reason: "seat_cap_reached",
      code: "seat_cap_reached",
      status: 403,
      messageEn: "Your organisation has no seats left.",
      messageId: "Organisasi Anda tidak memiliki kursi tersisa.",
      retryAfter: 5,
    });
  });

  it.each([
    ["tenant_inactive", 403],
    ["org_inactive", 403],
    ["org_past_due", 403],
    ["user_inactive", 403],
    ["device_revoked", 403],
    ["session_revoked", 401],
    ["refresh_reused", 401],
    ["refresh_expired", 401],
  ])("passes %s through verbatim", async (reason, status) => {
    const client = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ error: "invalid_grant", reason }, status)).impl,
    });
    await expect(client.exchangeCode({ code: "c", ...EXCHANGE })).rejects.toMatchObject({ reason, status });
  });

  it("falls back to the RFC family when the portal sends no reason", async () => {
    const client = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ error: "invalid_request" }, 400)).impl,
    });
    await expect(client.exchangeCode({ code: "", ...EXCHANGE })).rejects.toMatchObject({
      reason: "invalid_request",
      status: 400,
    });
  });

  it("maps an unknown reason to invalid_grant rather than inventing a code", async () => {
    const client = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ error: "invalid_grant", reason: "banana" }, 400)).impl,
    });
    await expect(client.exchangeCode({ code: "c", ...EXCHANGE })).rejects.toMatchObject({ reason: "invalid_grant" });
  });

  it("maps a portal 500 and a malformed body to portal_unavailable", async () => {
    const boom = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => new Response("<html>oops</html>", { status: 500 })).impl,
    });
    await expect(boom.exchangeCode({ code: "c", ...EXCHANGE })).rejects.toMatchObject({ reason: "portal_unavailable" });
    const garbage = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => new Response("not json", { status: 200 })).impl,
    });
    await expect(garbage.exchangeCode({ code: "c", ...EXCHANGE })).rejects.toMatchObject({
      reason: "portal_unavailable",
      status: 502,
    });
  });

  it("maps a transport failure to portal_unavailable", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(
      createPortalClient({ baseUrl, fetchImpl: impl }).exchangeCode({ code: "c", ...EXCHANGE }),
    ).rejects.toMatchObject({
      reason: "portal_unavailable",
      status: 503,
    });
  });

  it("rejects a 200 that is missing the tokens", async () => {
    const client = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ access_token: "a" })).impl,
    });
    await expect(client.exchangeCode({ code: "c", ...EXCHANGE })).rejects.toMatchObject({
      reason: "portal_unavailable",
    });
  });
});

describe("refresh", () => {
  it("uses the doc's refresh_token grant with the server-side device id", async () => {
    const { calls, impl } = recordingFetch(() => json(TOKEN_BODY));
    const client = createPortalClient({ baseUrl, fetchImpl: impl });
    await client.refresh({ refreshToken: "ref-secret", deviceId: "dev_1" });
    expect(calls[0].url).toBe("https://api.tokotokenai.com/auth/token");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "ref-secret",
      device_id: "dev_1",
    });
  });

  it("omits device_id when the browser session has none", async () => {
    const { calls, impl } = recordingFetch(() => json(TOKEN_BODY));
    await createPortalClient({ baseUrl, fetchImpl: impl }).refresh({ refreshToken: "r", deviceId: null });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ grant_type: "refresh_token", refresh_token: "r" });
  });

  it("reports a replayed refresh token as refresh_reused", async () => {
    const client = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ error: "invalid_grant", reason: "refresh_reused" }, 401)).impl,
    });
    await expect(client.refresh({ refreshToken: "r" })).rejects.toMatchObject({ reason: "refresh_reused" });
  });
});

describe("logout", () => {
  it("sends the access token as a Bearer and accepts 204", async () => {
    const { calls, impl } = recordingFetch(() => new Response(null, { status: 204 }));
    await createPortalClient({ baseUrl, fetchImpl: impl }).logout({ accessToken: "acc-secret" });
    expect(calls[0].url).toBe("https://api.tokotokenai.com/auth/logout");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer acc-secret");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ all_devices: false });
  });

  it("is idempotent: a portal 401 does not stop the local sign-out", async () => {
    const client = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ error: "invalid_grant", reason: "session_revoked" }, 401)).impl,
    });
    await expect(client.logout({ accessToken: "acc" })).resolves.toBeUndefined();
  });
});

describe("secrets", () => {
  it("never writes a token to the console, on success or on failure", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const ok = createPortalClient({ baseUrl, fetchImpl: recordingFetch(() => json(TOKEN_BODY)).impl });
    await ok.exchangeCode({ code: "K7M4PQ9T", ...EXCHANGE });
    const bad = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ error: "invalid_grant", reason: "refresh_expired" }, 401)).impl,
    });
    await bad.refresh({ refreshToken: "ref-secret" }).catch(() => undefined);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("keeps the token out of the error message", async () => {
    const client = createPortalClient({
      baseUrl,
      fetchImpl: recordingFetch(() => json({ error: "invalid_grant", reason: "refresh_expired" }, 401)).impl,
    });
    const error = (await client.refresh({ refreshToken: "ref-secret" }).catch((c: unknown) => c)) as Error;
    expect(error.message).not.toContain("ref-secret");
  });
});

describe("buildAuthorizeUrl", () => {
  it("is the frozen wire contract, parameter for parameter and in order", () => {
    expect(PORTAL_AUTHORIZE_PATH).toBe("/authorize");
    expect(
      buildAuthorizeUrl({
        baseUrl: "https://portal.example.test/api",
        clientId: "cli_abc",
        redirectUri: "https://app.example.test/auth/callback",
        state: "st_1",
      }),
    ).toBe(
      "https://portal.example.test/api/authorize?response_type=code&client_id=cli_abc" +
        "&redirect_uri=https%3A%2F%2Fapp.example.test%2Fauth%2Fcallback&state=st_1",
    );
  });

  it("percent-encodes every value it is handed", () => {
    const url = new URL(
      buildAuthorizeUrl({
        baseUrl: "https://portal.example.test",
        clientId: "cli abc&x=1",
        redirectUri: "https://app.example.test/auth/callback?next=/chat",
        state: "a+b/c=",
      }),
    );
    expect(url.searchParams.get("client_id")).toBe("cli abc&x=1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.test/auth/callback?next=/chat");
    expect(url.searchParams.get("state")).toBe("a+b/c=");
  });

  it("never carries the client secret", () => {
    const url = buildAuthorizeUrl({
      baseUrl: "https://portal.example.test",
      clientId: "cli_abc",
      redirectUri: "https://app.example.test/auth/callback",
      state: "st_1",
    });
    expect(url).not.toContain("secret");
    expect(new URL(url).searchParams.get("client_secret")).toBeNull();
  });
});

describe("createFakePortalClient", () => {
  it("hands back the seeded tokens and records the calls", async () => {
    const fake = createFakePortalClient({ tokens: { userId: "usr_9" } });
    const tokens = await fake.exchangeCode({ code: "abc", ...EXCHANGE });
    expect(tokens.userId).toBe("usr_9");
    expect(fake.calls).toEqual([
      {
        kind: "exchange",
        code: "abc",
        redirectUri: "https://app.example.test/auth/callback",
        clientId: "cli_abc",
      },
    ]);
    // The fake records what a test may assert on. The client secret is not that.
    expect(JSON.stringify(fake.calls)).not.toContain("sec_xyz");
  });

  it("refuses an exchange that is missing the confidential client's credentials", async () => {
    const fake = createFakePortalClient();
    await expect(fake.exchangeCode({ ...EXCHANGE, code: "abc", clientSecret: "" })).rejects.toMatchObject({
      reason: "invalid_request",
    });
  });

  it("throws the seeded PortalError", async () => {
    const fake = createFakePortalClient({ failWith: new PortalError("org_past_due", 403) });
    await expect(fake.exchangeCode({ code: "abc", ...EXCHANGE })).rejects.toMatchObject({ reason: "org_past_due" });
  });
});
