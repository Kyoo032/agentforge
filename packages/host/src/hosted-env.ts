/**
 * Does this hosted process have everything it needs to serve a tenant? Asked once, at boot, before
 * the listener opens (docs/internal/security-register.md, SR-04).
 *
 * WHY THIS EXISTS. Every hosted variable used to be read at FIRST USE, so a container with no wrap
 * key started, answered `GET /healthz` (which routes before anything and opens no database —
 * `webapp-deploy/Caddyfile:140-147`), passed Caddy's active check, and then failed for the first
 * real person who signed in or saved a key. A deployment that cannot serve anybody should say so
 * to the operator who is still watching the logs, not to a user an hour later. Same shape as
 * `apps/web/server/hosted-mode-guard.ts` and `resolveBindHost`: refuse to listen rather than listen
 * with half the deployment missing.
 *
 * TWO RULES THIS FILE KEEPS.
 *
 * 1. **Borrow every rule, invent none.** The wrap key is judged by `getLocalVaultKey`, the portal
 *    URL by `portalBaseUrl` (which is `assertAllowedEndpointUrl`), the client credentials by
 *    `portalClientCredentials`, the origin list by `trustedOrigins`, the billing secret by the one
 *    constant `verifyBillingRequest` reads. If one of those rules changes, this check changes with
 *    it, because it is the same code. A second copy of "what a good key looks like" is how two
 *    answers to the same question appear.
 * 2. **Names, never values.** Every problem carries the variable's NAME and the refusal the real
 *    validator produced. No branch here reads a value into a message, and `hosted-env.test.ts`
 *    pins that a secret placed in the environment does not appear in the text.
 *
 * LOCAL MODE IS UNTOUCHED. Off `AGENTFORGE_SERVER` this returns an empty list without reading a
 * single variable, so a desk, webdev and the e2e run behave exactly as they did.
 */
import { isServerMode, trustedOrigins, type EnvLike } from "@agentforge/core";
import { getLocalVaultKey } from "@agentforge/db/vault-key";
import { BILLING_SECRET_ENV } from "./billing/authenticate";
import { TOPUP_URL_ENV, TOPUP_URL_INVALID_WARNING, topUpUrlMisconfigured } from "./billing/topup-url";
import { portalBaseUrl, PORTAL_URL_ENV } from "./auth/portal-client";
import {
  portalClientCredentials,
  publicBaseUrl,
  PORTAL_CLIENT_ID_ENV,
  PORTAL_CLIENT_SECRET_ENV,
  PUBLIC_URL_ENV,
} from "./auth/portal-config";

export const SECRETS_KEY_ENV = "AGENTFORGE_SECRETS_KEY";
export const TRUSTED_ORIGINS_ENV = "AGENTFORGE_TRUSTED_ORIGINS";

/** The first line of the refusal, and what a test matches on. */
export const HOSTED_ENV_INCOMPLETE = "Hosted mode (AGENTFORGE_SERVER=1) refuses to start";

/**
 * A server that is not `NODE_ENV=production` — the review instance, a staging box — is allowed to
 * run with no payment provider bound, because there is nothing for a provider to call. It is not
 * allowed to run with nobody noticing, because the webhook then refuses every delivery with
 * `billing_not_configured` and the operator has no reason to connect the two.
 */
export const BILLING_SECRET_MISSING_WARNING =
  `WARNING: ${BILLING_SECRET_ENV} is not set. POST /api/v1/billing/webhook will refuse every ` +
  "delivery with billing_not_configured until it is. That is fine on a server with no payment " +
  "provider bound; it is a failed deployment on a production one, where this is required.";

export type HostedEnvProblem = {
  /** The environment variable an operator has to go and fix. */
  readonly variable: string;
  /** Why, in the words of the validator that owns the rule. Never carries a value. */
  readonly detail: string;
};

/** What an error says, without letting a non-Error stringify into something surprising. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : "is not usable.";
}

/** True for the one `NODE_ENV` that means a real, paying deployment. */
function isProduction(env: EnvLike): boolean {
  return env.NODE_ENV?.trim() === "production";
}

/**
 * `AGENTFORGE_SECRETS_KEY`, judged by the code that will later derive the wrap key from it.
 *
 * In server mode `getLocalVaultKey` never touches the disk — the `.master-key` fallback is in the
 * other branch — so this is a pure check of the variable. The derived key is discarded; it is
 * re-derived at first use as it always was.
 */
function vaultKeyProblem(env: EnvLike): HostedEnvProblem | null {
  try {
    getLocalVaultKey(env);
    return null;
  } catch (error) {
    return { variable: SECRETS_KEY_ENV, detail: detailOf(error) };
  }
}

/**
 * `AGENTFORGE_TRUSTED_ORIGINS`, judged by the allowlist the CSRF and Origin rules read.
 *
 * In server mode there is no default and cleartext entries are dropped, so "at least one entry
 * survives" is the real question, not "is the variable set". A server whose list empties out
 * accepts no mutating call from any browser: every save, every send, every upload 403s.
 */
function trustedOriginsProblem(env: EnvLike): HostedEnvProblem | null {
  if (trustedOrigins(env).length > 0) {
    return null;
  }
  const raw = env[TRUSTED_ORIGINS_ENV]?.trim();
  return {
    variable: TRUSTED_ORIGINS_ENV,
    detail: raw
      ? "is set, but no https origin survives it (server mode drops cleartext and anything that is not an origin). No browser could make a mutating /api call."
      : "is not set, and the hosted server has no default. No browser could make a mutating /api call.",
  };
}

/** `AGENTFORGE_PORTAL_URL`, judged by `portalBaseUrl` → `assertAllowedEndpointUrl`. */
function portalUrlProblem(env: EnvLike): HostedEnvProblem | null {
  try {
    portalBaseUrl(env);
    return null;
  } catch (error) {
    return { variable: PORTAL_URL_ENV, detail: detailOf(error) };
  }
}

const CLIENT_CREDENTIAL_ENVS = [PORTAL_CLIENT_ID_ENV, PORTAL_CLIENT_SECRET_ENV] as const;

/**
 * The two client credentials, judged by `portalClientCredentials`.
 *
 * That function refuses the FIRST variable it finds wanting, which would hide the second from an
 * operator until the next restart. So each is probed in an environment where the other is
 * stubbed: whatever comes back is about this variable alone. The stub is a constant string that is
 * never read as a credential — nothing here calls the portal.
 */
function clientCredentialProblems(env: EnvLike): HostedEnvProblem[] {
  const problems: HostedEnvProblem[] = [];
  for (const variable of CLIENT_CREDENTIAL_ENVS) {
    const other = variable === PORTAL_CLIENT_ID_ENV ? PORTAL_CLIENT_SECRET_ENV : PORTAL_CLIENT_ID_ENV;
    try {
      portalClientCredentials({ ...env, [other]: env[other]?.trim() || "stub-for-this-probe" });
    } catch (error) {
      problems.push({ variable, detail: detailOf(error) });
    }
  }
  return problems;
}

/**
 * `AGENTFORGE_PUBLIC_URL`, only when it is set.
 *
 * Left unset it falls back to the first trusted origin, which `trustedOriginsProblem` already
 * covers. Set to something the browser cannot reach this deployment on, it is a sign-in flow that
 * 503s at the first click — cheap to catch here, and the same `publicBaseUrl` the flow will use.
 */
function publicUrlProblem(env: EnvLike): HostedEnvProblem | null {
  if (!env[PUBLIC_URL_ENV]?.trim()) {
    return null;
  }
  try {
    publicBaseUrl(env);
    return null;
  } catch (error) {
    return { variable: PUBLIC_URL_ENV, detail: detailOf(error) };
  }
}

/** `AGENTFORGE_BILLING_WEBHOOK_SECRET` — required on production, a warning elsewhere (see above). */
function billingSecretProblem(env: EnvLike): HostedEnvProblem | null {
  if (env[BILLING_SECRET_ENV]?.trim() || !isProduction(env)) {
    return null;
  }
  return {
    variable: BILLING_SECRET_ENV,
    detail:
      "is not set, so POST /api/v1/billing/webhook would refuse every delivery with billing_not_configured and no tenant's plan could ever go active.",
  };
}

/**
 * Everything wrong with this environment, in the order an operator would fix it. Empty off server
 * mode, and empty when the deployment is complete.
 */
export function hostedEnvProblems(env: EnvLike = process.env): HostedEnvProblem[] {
  if (!isServerMode(env)) {
    return [];
  }
  return [
    vaultKeyProblem(env),
    trustedOriginsProblem(env),
    portalUrlProblem(env),
    ...clientCredentialProblems(env),
    publicUrlProblem(env),
    billingSecretProblem(env),
  ].filter((problem): problem is HostedEnvProblem => problem !== null);
}

/** One message, every problem, no values. */
export function formatHostedEnvFailure(problems: readonly HostedEnvProblem[]): string {
  const lines = problems.map((problem) => `  - ${problem.variable}: ${problem.detail}`);
  return [
    `${HOSTED_ENV_INCOMPLETE}: ${problems.length} required environment ${
      problems.length === 1 ? "variable is" : "variables are"
    } missing or unusable.`,
    ...lines,
    "Fix every line above before starting again; webapp-deploy/.env.example documents all of them. " +
      "Only names are printed here, never values.",
  ].join("\n");
}

/**
 * Called once at boot, beside `assertHostedModeCoherent`, before the listener opens.
 *
 * `warn` is a parameter so the tests can read the warning without touching the console, and so a
 * future structured logger can be handed in without changing this file.
 */
export function assertHostedEnvComplete(
  env: EnvLike = process.env,
  warn: (message: string) => void = console.warn,
): void {
  if (!isServerMode(env)) {
    return;
  }
  const problems = hostedEnvProblems(env);
  if (problems.length > 0) {
    throw new Error(formatHostedEnvFailure(problems));
  }
  if (!env[BILLING_SECRET_ENV]?.trim()) {
    warn(BILLING_SECRET_MISSING_WARNING);
  }
  // Warn-only, and deliberately so: an unusable checkout link is a dead button on one screen, not a
  // deployment that cannot serve anybody. The route refuses it independently — same function, same
  // answer — so the worst case without this warning is silence, which is what it exists to break.
  if (topUpUrlMisconfigured(env[TOPUP_URL_ENV])) {
    warn(TOPUP_URL_INVALID_WARNING);
  }
}
