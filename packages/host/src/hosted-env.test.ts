/**
 * SR-04 — the hosted deployment refuses to listen with an incomplete environment.
 *
 * Table-driven, because the thing under test is a SET: one variable at a time, then several at
 * once, then the whole set present. The assertions that matter beyond "it threw" are that the
 * message names every broken variable in one go (an operator who fixes one and restarts should not
 * discover the next one on the third attempt) and that no value is ever printed.
 */
import { describe, expect, it } from "vitest";
import type { EnvLike } from "@agentforge/core";
import {
  assertHostedEnvComplete,
  BILLING_SECRET_MISSING_WARNING,
  hostedEnvProblems,
  HOSTED_ENV_INCOMPLETE,
} from "./hosted-env";
import { TOPUP_URL_INVALID_WARNING } from "./billing/topup-url";

/** 32 random bytes, 31 distinct — what `openssl rand -hex 32` produces, and what vault-key wants. */
const GOOD_KEY = "9f3c1a7e5b0d26483fae91c7d054b8236e7a1f09c35d8b4260ae719cf83b512d";
const GOOD_SECRET = "a-billing-secret-nobody-else-knows";

/** Everything a hosted process needs, and nothing it does not. */
function completeEnv(overrides: Record<string, string | undefined> = {}): EnvLike {
  return {
    AGENTFORGE_SERVER: "1",
    NODE_ENV: "production",
    AGENTFORGE_SECRETS_KEY: GOOD_KEY,
    AGENTFORGE_TRUSTED_ORIGINS: "https://dpsbuddy.example.com",
    AGENTFORGE_PORTAL_URL: "https://portal.example.com/api",
    AGENTFORGE_PORTAL_CLIENT_ID: "dpsbuddy-web",
    AGENTFORGE_PORTAL_CLIENT_SECRET: "client-secret-value",
    AGENTFORGE_BILLING_WEBHOOK_SECRET: GOOD_SECRET,
    ...overrides,
  };
}

function names(env: EnvLike): string[] {
  return hostedEnvProblems(env).map((problem) => problem.variable);
}

function messageFor(env: EnvLike): string {
  try {
    assertHostedEnvComplete(env, () => {});
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected assertHostedEnvComplete to refuse this environment");
}

describe("a complete hosted environment boots", () => {
  it("finds nothing to complain about", () => {
    expect(hostedEnvProblems(completeEnv())).toEqual([]);
    expect(() => assertHostedEnvComplete(completeEnv(), () => {})).not.toThrow();
  });

  it("accepts a canonical base64 wrap key, the shape a secrets manager hands out", () => {
    const base64 = Buffer.from(GOOD_KEY, "hex").toString("base64");
    expect(names(completeEnv({ AGENTFORGE_SECRETS_KEY: base64 }))).toEqual([]);
  });

  it("accepts a loopback portal, which is what a review instance runs", () => {
    expect(names(completeEnv({ AGENTFORGE_PORTAL_URL: "http://127.0.0.1:4000" }))).toEqual([]);
  });
});

describe("each variable, one at a time", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly env: Record<string, string | undefined>;
    readonly expect: readonly string[];
  }> = [
    { name: "wrap key absent", env: { AGENTFORGE_SECRETS_KEY: undefined }, expect: ["AGENTFORGE_SECRETS_KEY"] },
    { name: "wrap key blank", env: { AGENTFORGE_SECRETS_KEY: "   " }, expect: ["AGENTFORGE_SECRETS_KEY"] },
    {
      name: "wrap key is a passphrase, not an encoding",
      env: { AGENTFORGE_SECRETS_KEY: "correct horse battery staple correct horse" },
      expect: ["AGENTFORGE_SECRETS_KEY"],
    },
    {
      name: "wrap key is the right length but typed",
      env: { AGENTFORGE_SECRETS_KEY: "a".repeat(64) },
      expect: ["AGENTFORGE_SECRETS_KEY"],
    },
    {
      name: "wrap key is half a key",
      env: { AGENTFORGE_SECRETS_KEY: GOOD_KEY.slice(0, 32) },
      expect: ["AGENTFORGE_SECRETS_KEY"],
    },
    {
      name: "trusted origins absent",
      env: { AGENTFORGE_TRUSTED_ORIGINS: undefined },
      expect: ["AGENTFORGE_TRUSTED_ORIGINS"],
    },
    {
      name: "trusted origins blank",
      env: { AGENTFORGE_TRUSTED_ORIGINS: "" },
      expect: ["AGENTFORGE_TRUSTED_ORIGINS"],
    },
    {
      name: "trusted origins are all cleartext, so server mode drops every one",
      env: { AGENTFORGE_TRUSTED_ORIGINS: "http://dpsbuddy.example.com,http://localhost:3000" },
      expect: ["AGENTFORGE_TRUSTED_ORIGINS"],
    },
    {
      name: "trusted origins are not origins at all",
      env: { AGENTFORGE_TRUSTED_ORIGINS: "dpsbuddy.example.com, ftp://x" },
      expect: ["AGENTFORGE_TRUSTED_ORIGINS"],
    },
    { name: "portal url absent", env: { AGENTFORGE_PORTAL_URL: undefined }, expect: ["AGENTFORGE_PORTAL_URL"] },
    {
      name: "portal url is cleartext off loopback",
      env: { AGENTFORGE_PORTAL_URL: "http://portal.example.com" },
      expect: ["AGENTFORGE_PORTAL_URL"],
    },
    {
      name: "portal url carries credentials",
      env: { AGENTFORGE_PORTAL_URL: "https://user:pass@portal.example.com" },
      expect: ["AGENTFORGE_PORTAL_URL"],
    },
    {
      name: "portal url is not a url",
      env: { AGENTFORGE_PORTAL_URL: "portal.example.com" },
      expect: ["AGENTFORGE_PORTAL_URL"],
    },
    {
      name: "client id absent",
      env: { AGENTFORGE_PORTAL_CLIENT_ID: undefined },
      expect: ["AGENTFORGE_PORTAL_CLIENT_ID"],
    },
    {
      name: "client secret absent",
      env: { AGENTFORGE_PORTAL_CLIENT_SECRET: "  " },
      expect: ["AGENTFORGE_PORTAL_CLIENT_SECRET"],
    },
    {
      name: "billing secret absent in production",
      env: { AGENTFORGE_BILLING_WEBHOOK_SECRET: undefined },
      expect: ["AGENTFORGE_BILLING_WEBHOOK_SECRET"],
    },
    {
      name: "an explicit public url that is not an origin the browser could reach",
      env: { AGENTFORGE_PUBLIC_URL: "http://dpsbuddy.example.com" },
      expect: ["AGENTFORGE_PUBLIC_URL"],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(names(completeEnv(testCase.env))).toEqual([...testCase.expect]);
    });
  }
});

describe("the refusal is one message that names every broken variable", () => {
  const broken = completeEnv({
    AGENTFORGE_SECRETS_KEY: undefined,
    AGENTFORGE_TRUSTED_ORIGINS: "http://dpsbuddy.example.com",
    AGENTFORGE_PORTAL_URL: undefined,
    AGENTFORGE_PORTAL_CLIENT_ID: "",
    AGENTFORGE_PORTAL_CLIENT_SECRET: "",
    AGENTFORGE_BILLING_WEBHOOK_SECRET: "",
  });

  it("refuses once, not six times", () => {
    expect(() => assertHostedEnvComplete(broken, () => {})).toThrow(HOSTED_ENV_INCOMPLETE);
  });

  it("names all six in the same message", () => {
    const message = messageFor(broken);
    for (const variable of [
      "AGENTFORGE_SECRETS_KEY",
      "AGENTFORGE_TRUSTED_ORIGINS",
      "AGENTFORGE_PORTAL_URL",
      "AGENTFORGE_PORTAL_CLIENT_ID",
      "AGENTFORGE_PORTAL_CLIENT_SECRET",
      "AGENTFORGE_BILLING_WEBHOOK_SECRET",
    ]) {
      expect(message, variable).toContain(variable);
    }
  });

  it("points the operator at the template that lists them", () => {
    expect(messageFor(broken)).toContain("webapp-deploy/.env.example");
  });

  it("prints no value, only names — not even of the variables that are fine", () => {
    const message = messageFor(
      completeEnv({
        AGENTFORGE_SECRETS_KEY: "correct horse battery staple correct horse",
        AGENTFORGE_PORTAL_CLIENT_ID: undefined,
      }),
    );
    expect(message).not.toContain("correct horse");
    expect(message).not.toContain(GOOD_KEY);
    expect(message).not.toContain(GOOD_SECRET);
    expect(message).not.toContain("client-secret-value");
  });
});

describe("the billing secret is required in production and loud everywhere else", () => {
  it("is part of the refusal when NODE_ENV=production", () => {
    expect(names(completeEnv({ AGENTFORGE_BILLING_WEBHOOK_SECRET: undefined }))).toEqual([
      "AGENTFORGE_BILLING_WEBHOOK_SECRET",
    ]);
  });

  it("is a startup warning, not a refusal, on a server that is not production", () => {
    const warnings: string[] = [];
    const env = completeEnv({ NODE_ENV: "staging", AGENTFORGE_BILLING_WEBHOOK_SECRET: undefined });
    expect(() => assertHostedEnvComplete(env, (line) => warnings.push(line))).not.toThrow();
    expect(warnings).toEqual([BILLING_SECRET_MISSING_WARNING]);
    expect(BILLING_SECRET_MISSING_WARNING).toContain("AGENTFORGE_BILLING_WEBHOOK_SECRET");
  });

  it("says nothing at all when it is set", () => {
    const warnings: string[] = [];
    assertHostedEnvComplete(completeEnv({ NODE_ENV: "staging" }), (line) => warnings.push(line));
    expect(warnings).toEqual([]);
  });
});

/**
 * `AGENTFORGE_BILLING_TOPUP_URL` — warn-only on purpose.
 *
 * An unusable checkout link is a dead button on one screen, not a deployment that cannot serve
 * anybody, so it must not join the refusal. But it used to be echoed to the browser unvalidated and
 * turned into an `href`, so it must not be silent either: `POST /api/v1/billing/top-up` refuses it
 * with the same function, and this is how the operator finds out before a blocked tenant does.
 */
describe("the top-up link is checked at boot, by name", () => {
  const warningsFor = (value: string | undefined): string[] => {
    const warnings: string[] = [];
    assertHostedEnvComplete(completeEnv({ AGENTFORGE_BILLING_TOPUP_URL: value }), (line) => warnings.push(line));
    return warnings;
  };

  it.each(["javascript:alert(1)", "data:text/html,x", "/topup", "pay.example.test"])(
    "warns about %s without refusing the boot",
    (value) => {
      expect(warningsFor(value)).toEqual([TOPUP_URL_INVALID_WARNING]);
      expect(names(completeEnv({ AGENTFORGE_BILLING_TOPUP_URL: value }))).toEqual([]);
    },
  );

  it("never prints the value, only the variable name", () => {
    expect(TOPUP_URL_INVALID_WARNING).toContain("AGENTFORGE_BILLING_TOPUP_URL");
    expect(warningsFor("javascript:alert(document.cookie)").join("\n")).not.toContain("alert");
  });

  it("is silent for a usable link and for the variable being unset", () => {
    expect(warningsFor("https://pay.example.test/topup")).toEqual([]);
    expect(warningsFor("http://pay.example.test/topup")).toEqual([]);
    expect(warningsFor(undefined)).toEqual([]);
    // Whitespace is "unset", not "wrong": there is nothing for an operator to go and fix.
    expect(warningsFor("   ")).toEqual([]);
  });
});

/**
 * The half of this that must never change: a desk, webdev and the e2e run do not set
 * `AGENTFORGE_SERVER`, and none of these variables exists there. If the check ever ran off server
 * mode it would refuse to start the app every developer uses.
 */
describe("local mode is untouched", () => {
  const localEnvs: ReadonlyArray<readonly [string, EnvLike]> = [
    ["a bare environment", {}],
    ["webdev", { NODE_ENV: "development" }],
    ["the e2e run", { NODE_ENV: "test", AGENTFORGE_RUNTIME: "stub" }],
    ["the flag explicitly off", { AGENTFORGE_SERVER: "0", NODE_ENV: "production" }],
    ["a desk with a weak key and no portal", { AGENTFORGE_SECRETS_KEY: "hunter2" }],
  ];

  for (const [name, env] of localEnvs) {
    it(`finds nothing to check in ${name}`, () => {
      const warnings: string[] = [];
      expect(hostedEnvProblems(env)).toEqual([]);
      expect(() => assertHostedEnvComplete(env, (line) => warnings.push(line))).not.toThrow();
      expect(warnings).toEqual([]);
    });
  }
});
