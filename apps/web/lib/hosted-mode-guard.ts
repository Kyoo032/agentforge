import { isServerMode, type EnvLike } from "@agentforge/core";

/**
 * Refuses to boot a production build that is not in server mode
 * (docs/internal/security-owasp-2026-09.md, finding A05-1).
 *
 * `isServerMode()` is the single switch behind every hosted-only control: the session gate
 * (`packages/host/src/router.ts`), the CSRF and Origin/Host rules and the HTTPS-only refusal
 * (`packages/host/src/http-adapter.ts`), the rate limiters (`packages/host/src/rate-limit.ts`),
 * the mandatory wrap key (`packages/db/src/vault-key.ts`), the gate that fails closed and the
 * refused "Start over". With the flag off, none of them run.
 *
 * The flag reached the container from one optional file — `webapp-deploy/compose.yml` declared
 * `env_file: { required: false }` and never set `AGENTFORGE_SERVER` itself — so a missing or
 * mistyped `.env` silently downgraded the public deployment to the desktop's loopback rules. That
 * is not a loud failure: mutating calls still 403 (Caddy forwards the public Host, which the
 * loopback rule rejects), but **every `GET /api/v1/*` answers without a session**, and the Docker
 * healthcheck polls `/api/v1/components`, which is ungated in both modes, so the container reports
 * healthy while serving settings, threads, artifacts and media to anyone who asks.
 *
 * `NODE_ENV=production` is an exact signal in this repo: the only thing that sets it is
 * `apps/web/package.json` `"start"`, which is the hosted entrypoint and the Dockerfile's `CMD`.
 * Webdev and the e2e run use `pnpm dev`, and the frozen desktop shell never loads `server.ts` at
 * all — so nothing legitimate reaches this check with the flag off.
 *
 * Throwing is the same shape as `resolveBindHost` in `./bind-host`: a deployment that cannot be
 * served safely refuses to listen rather than listening with the controls off.
 */
export const HOSTED_MODE_REQUIRED =
  "NODE_ENV=production starts the hosted server, but AGENTFORGE_SERVER is not set. " +
  "Every hosted control — the session gate, CSRF, the Origin allowlist, the HTTPS-only rule, the " +
  "rate limiters and the mandatory AGENTFORGE_SECRETS_KEY — is switched off without it, and the " +
  "health check would still pass. Set AGENTFORGE_SERVER=1 (webapp-deploy/compose.yml pins it), or " +
  "run the local build with `pnpm dev` instead of `pnpm start`.";

/** True for the one value of `NODE_ENV` that means "this process is the hosted server". */
function isProductionBuild(env: EnvLike): boolean {
  return env.NODE_ENV?.trim() === "production";
}

/**
 * Called once at boot, before the listener is opened. A no-op everywhere but the misconfiguration
 * it exists to catch, so webdev, the e2e run and a correctly configured container are untouched.
 */
export function assertHostedModeCoherent(env: EnvLike): void {
  if (isProductionBuild(env) && !isServerMode(env)) {
    throw new Error(HOSTED_MODE_REQUIRED);
  }
}
