import { isServerMode, type EnvLike } from "@agentforge/core";

/**
 * Which interface `server.ts` listens on (docs/internal/web-security-spec.md N5).
 *
 * The default is loopback, so a local run is never reachable from the LAN. A non-loopback bind is a
 * deliberate hosted choice: it is allowed only with `AGENTFORGE_SERVER` on, where a reverse proxy is
 * the public listener and the container has to bind its own interface. Anything else throws at boot,
 * loudly, instead of quietly exposing a desk.
 */
export const LOOPBACK_BIND_HOST = "127.0.0.1";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([LOOPBACK_BIND_HOST, "localhost", "::1"]);

export function resolveBindHost(env: EnvLike): string {
  const requested = env.BIND_HOST?.trim();
  if (!requested) {
    return LOOPBACK_BIND_HOST;
  }
  if (LOOPBACK_HOSTS.has(requested.toLowerCase()) || isServerMode(env)) {
    return requested;
  }
  throw new Error(
    `BIND_HOST=${requested} would expose this server beyond loopback. Set AGENTFORGE_SERVER=1 for a hosted deployment, or leave BIND_HOST unset to bind ${LOOPBACK_BIND_HOST}.`,
  );
}
