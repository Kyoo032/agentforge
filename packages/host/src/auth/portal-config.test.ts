/**
 * Phase 9 lane F — the three environment variables the browser login reads, and the one refusal
 * they share.
 *
 * Every case passes its own `env`; nothing here touches `process.env`, so these run in parallel
 * with the rest of the suite.
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import {
  AUTH_CALLBACK_PATH,
  LOGIN_CONFIG_ERROR,
  PORTAL_CLIENT_ID_ENV,
  PORTAL_CLIENT_SECRET_ENV,
  PUBLIC_URL_ENV,
  configuredClientCredentials,
  portalClientCredentials,
  portalLoginConfig,
  publicBaseUrl,
  publicRedirectUri,
} from "./portal-config";

const SERVER = { AGENTFORGE_SERVER: "1" } as const;

function configError(run: () => unknown): ApiError {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a configuration refusal");
}

describe("publicBaseUrl", () => {
  it("prefers AGENTFORGE_PUBLIC_URL", () => {
    expect(
      publicBaseUrl({
        ...SERVER,
        [PUBLIC_URL_ENV]: "https://app.example.test",
        AGENTFORGE_TRUSTED_ORIGINS: "https://other.example.test",
      }),
    ).toBe("https://app.example.test");
  });

  it("normalises the value to a bare origin", () => {
    expect(publicBaseUrl({ ...SERVER, [PUBLIC_URL_ENV]: "https://App.Example.Test/some/path?q=1" })).toBe(
      "https://app.example.test",
    );
  });

  it("allows plain http on loopback, for the local review instance", () => {
    expect(publicBaseUrl({ [PUBLIC_URL_ENV]: "http://127.0.0.1:3100" })).toBe("http://127.0.0.1:3100");
    expect(publicBaseUrl({ [PUBLIC_URL_ENV]: "http://localhost:3100" })).toBe("http://localhost:3100");
  });

  it("refuses plain http off loopback rather than quietly downgrading the redirect", () => {
    const error = configError(() => publicBaseUrl({ ...SERVER, [PUBLIC_URL_ENV]: "http://app.example.test" }));
    expect(error.code).toBe(LOGIN_CONFIG_ERROR);
    expect(error.status).toBe(503);
  });

  it("refuses a value that is not a URL at all", () => {
    expect(configError(() => publicBaseUrl({ ...SERVER, [PUBLIC_URL_ENV]: "app.example.test" })).status).toBe(503);
  });

  it("falls back to the first trusted origin", () => {
    expect(
      publicBaseUrl({ ...SERVER, AGENTFORGE_TRUSTED_ORIGINS: "https://one.example.test,https://two.example.test" }),
    ).toBe("https://one.example.test");
  });

  it("refuses when neither is configured — a server with no public name cannot build a redirect_uri", () => {
    const error = configError(() => publicBaseUrl({ ...SERVER }));
    expect(error.code).toBe(LOGIN_CONFIG_ERROR);
    expect(error.status).toBe(503);
    expect(error.message).toContain(PUBLIC_URL_ENV);
  });
});

describe("publicRedirectUri", () => {
  it("is the public base plus the app's callback route", () => {
    expect(AUTH_CALLBACK_PATH).toBe("/auth/callback");
    expect(publicRedirectUri({ ...SERVER, [PUBLIC_URL_ENV]: "https://app.example.test" })).toBe(
      "https://app.example.test/auth/callback",
    );
  });
});

describe("portalClientCredentials", () => {
  it("reads the confidential client's id and secret", () => {
    expect(
      portalClientCredentials({ [PORTAL_CLIENT_ID_ENV]: " cli_abc ", [PORTAL_CLIENT_SECRET_ENV]: " sec_xyz " }),
    ).toEqual({ clientId: "cli_abc", clientSecret: "sec_xyz" });
  });

  it.each([
    [{ [PORTAL_CLIENT_SECRET_ENV]: "sec_xyz" }, PORTAL_CLIENT_ID_ENV],
    [{ [PORTAL_CLIENT_ID_ENV]: "cli_abc" }, PORTAL_CLIENT_SECRET_ENV],
    [{}, PORTAL_CLIENT_ID_ENV],
  ])("refuses when one is missing, naming which", (env, named) => {
    const error = configError(() => portalClientCredentials(env));
    expect(error.code).toBe(LOGIN_CONFIG_ERROR);
    expect(error.status).toBe(503);
    expect(error.message).toContain(named);
  });

  it("never puts the secret in the refusal", () => {
    const error = configError(() => portalClientCredentials({ [PORTAL_CLIENT_ID_ENV]: "cli_abc" }));
    expect(error.message).not.toContain("sec_");
  });
});

describe("portalLoginConfig", () => {
  it("is the three together, with the portal's own base URL", () => {
    expect(
      portalLoginConfig({
        ...SERVER,
        AGENTFORGE_PORTAL_URL: "https://portal.example.test/api/",
        [PORTAL_CLIENT_ID_ENV]: "cli_abc",
        [PORTAL_CLIENT_SECRET_ENV]: "sec_xyz",
        [PUBLIC_URL_ENV]: "https://app.example.test",
      }),
    ).toEqual({
      portalBaseUrl: "https://portal.example.test/api",
      clientId: "cli_abc",
      clientSecret: "sec_xyz",
      redirectUri: "https://app.example.test/auth/callback",
    });
  });

  it("reports an absent portal URL as the same configuration refusal, not a 500", () => {
    const error = configError(() =>
      portalLoginConfig({
        ...SERVER,
        [PORTAL_CLIENT_ID_ENV]: "cli_abc",
        [PORTAL_CLIENT_SECRET_ENV]: "sec_xyz",
        [PUBLIC_URL_ENV]: "https://app.example.test",
      }),
    );
    expect(error.code).toBe(LOGIN_CONFIG_ERROR);
    expect(error.status).toBe(503);
  });
});

/**
 * The same two values for the refresh, read without the refusal: the code exchange cannot proceed
 * without a client and says so, but a refresh can — it is counted against the address instead —
 * and a desk or webdev, which has no portal client at all, must not throw on every portal check.
 */
describe("configuredClientCredentials", () => {
  it("is exactly what portalClientCredentials reads, when both are set", () => {
    const env = { [PORTAL_CLIENT_ID_ENV]: " cli_abc ", [PORTAL_CLIENT_SECRET_ENV]: " sec_xyz " };
    expect(configuredClientCredentials(env)).toEqual(portalClientCredentials(env));
  });

  it.each([
    ["no id", { [PORTAL_CLIENT_SECRET_ENV]: "sec_xyz" }],
    ["no secret", { [PORTAL_CLIENT_ID_ENV]: "cli_abc" }],
    ["a blank secret", { [PORTAL_CLIENT_ID_ENV]: "cli_abc", [PORTAL_CLIENT_SECRET_ENV]: "  " }],
    ["neither", {}],
  ])("is null, not a refusal, with %s", (_name, env) => {
    expect(configuredClientCredentials(env)).toBeNull();
  });
});
