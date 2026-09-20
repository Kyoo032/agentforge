/**
 * Server mode: the hosted, multi-tenant web deployment (docs/internal/web-pivot-2026-09-18.md).
 *
 * One flag decides every hosted-only rule: the web Origin allowlist and CSRF, the mandatory wrap key,
 * the gate that fails closed, the disabled "Start over". Webdev (:3000) and the frozen desktop never
 * set it, so their behaviour is unchanged.
 */
export type EnvLike = Readonly<Record<string, string | undefined>>;

const WEBDEV_DEFAULT_PORT = "3000";

export function isServerMode(env: EnvLike = process.env): boolean {
  const raw = env.AGENTFORGE_SERVER?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * The environment a hosted process is allowed to read provider credentials from: none of it.
 * A frozen empty object rather than a branch per field, so a field added later cannot quietly
 * reintroduce the fallback by forgetting the check.
 */
const EMPTY_PROVIDER_ENV: NodeJS.ProcessEnv = Object.freeze({});

/**
 * Phase 4 — the operator's own keys are not a tenant's keys.
 *
 * Every read of a provider credential (inference key, provider base URL, tool key) out of the
 * process environment goes through this one function, which hands back an empty environment in
 * server mode. Off the hosted server it returns `env` unchanged, so webdev's `.env`, the documented
 * headless fallback and the frozen desktop behave exactly as they always have.
 *
 * In server mode a process-wide `OPENAI_API_KEY` is the OPERATOR's credential. Falling back to it
 * would hand it to every signed-in tenant who has not saved one — billed to the operator, metered
 * against nobody, and usable from any tenant session by making a call. That is the residual
 * `docs/internal/security-owasp-2026-09.md` A01-3 left for this phase ("on a hosted box any tenant
 * can still set the shared gateway key"): Phase 3 lane D made the SAVED key per tenant, and this is
 * the other half — the unsaved one. A hosted tenant with no key of its own gets no key at all, the
 * gate reports `needs_key`, and onboarding asks for one. Fail closed.
 *
 * The call sites are asserted by the static sweep in
 * `packages/core/src/provider-env-sweep.test.ts`, so a fourth one cannot appear unreviewed.
 */
export function providerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return isServerMode(env) ? EMPTY_PROVIDER_ENV : env;
}

/**
 * Origins allowed to make mutating `/api` calls. Explicit `AGENTFORGE_TRUSTED_ORIGINS` (comma list)
 * wins; outside server mode the webdev loopback origins are the default; in server mode there is no
 * default, so an unconfigured server accepts no mutating call from a browser.
 */
export function trustedOrigins(env: EnvLike = process.env): string[] {
  const serverMode = isServerMode(env);
  const raw = env.AGENTFORGE_TRUSTED_ORIGINS;
  if (raw !== undefined && raw.trim() !== "") {
    return parseOriginList(raw, serverMode);
  }
  if (serverMode) {
    return [];
  }
  const port = env.PORT?.trim() || WEBDEV_DEFAULT_PORT;
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/** The scheme the hosted deployment is reachable on; anything else is a downgrade. */
const HTTPS_SCHEME = "https:";

/**
 * In server mode a cleartext origin is dropped rather than trusted (security spec N3).
 *
 * The hosted deployment is HTTPS end to end — Caddy terminates TLS and the app sits on loopback
 * behind it — so an `http://` entry in the allowlist can only be a misconfiguration or an attempt to
 * make a downgraded page a trusted writer. Off server mode nothing is filtered: webdev and the
 * desktop ARE http loopback.
 */
function parseOriginList(raw: string, httpsOnly: boolean): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const origin = normaliseOrigin(part);
    if (origin && (!httpsOnly || new URL(origin).protocol === HTTPS_SCHEME)) {
      seen.add(origin);
    }
  }
  return [...seen];
}

/** Returns the lower-cased `scheme://host[:port]` of an http(s) URL, or null for anything else. */
export function normaliseOrigin(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url.origin.toLowerCase();
}
