import { isServerMode, type EnvLike } from "@agentforge/core";

/**
 * WHY THIS FILE IS IN `apps/web/server/` AND NOT IN `apps/web/lib/`.
 *
 * It re-exports `@agentforge/host`, which is the server side — `@agentforge/db`, `better-sqlite3`,
 * `node:fs`, the whole host. `apps/web/lib` is the RENDERER's namespace: every file there is
 * reachable from a component through the `@/lib` alias, and one import of this module from a
 * component is all it would take for Vite to start pulling the host into a browser bundle.
 * AGENTS.md "Shell vs app" is the rule, and `meeting-recorder-media.ts` duplicates a host constant
 * by hand rather than break it — while this module sat in the middle of the renderer's own
 * directory as the single exception, which is how exceptions stop being noticed.
 *
 * It is loaded only by `server.ts`. `renderer-imports.test.ts` holds the boundary from the other
 * side, so nothing under `components/`, `lib/` or `src/` can reach the host again without a test
 * saying so.
 *
 * The second half of the boot refusal, and the reason this module re-exports rather than defines
 * it (docs/internal/security-register.md, SR-04).
 *
 * `assertHostedModeCoherent` below answers "is this process the hosted server at all?". It does not
 * answer "can this hosted server serve anybody?" — that needs the wrap-key rule from
 * `@agentforge/db`, the endpoint rule from `@agentforge/core` and the portal-client rule from
 * `@agentforge/host`, and the point of SR-04 is to reuse those rules rather than restate them. So
 * the check itself lives at `packages/host/src/hosted-env.ts`, where all three are in scope, and
 * `server.ts` reaches both guards through this one module.
 */
export { assertHostedEnvComplete, HOSTED_ENV_INCOMPLETE } from "@agentforge/host/hosted-env";

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
