/** Argument parsing for `pnpm portal:seed`. Its own file so the seed itself stays testable. */

export interface SeedArgs {
  readonly email: string;
  readonly tenantSlug: string;
  /**
   * `null` when `--tenant-name` was not passed, and that is the whole point of the type.
   *
   * A new tenant falls back to the slug, as it always did. An EXISTING tenant is renamed only when
   * a name was actually asked for: defaulting this to the slug would make every re-run that forgot
   * the flag -- which is every re-run, since the flag is rarely repeated -- silently reset a
   * display name somebody chose. Same rule as `--redirect`, which adds and never replaces.
   */
  readonly tenantName: string | null;
  readonly orgName: string;
  readonly orgSlug: string;
  readonly seatCap: number;
  readonly redirectUris: readonly string[];
  readonly clientId: string;
  readonly clientName: string;
  readonly rotateSecret: boolean;
}

export class SeedArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedArgsError";
  }
}

const DEFAULT_TENANT = "dpsbuddy";
const DEFAULT_ORG = "Kyo";
const DEFAULT_SEAT_CAP = 20;
/**
 * The review instance from `web-phase9-portal-login.md`: the product in server mode behind the
 * TLS proxy on 3443. Hosted mode 403s plain http, so a loopback http callback would never work.
 */
const DEFAULT_REDIRECT = "https://localhost:3443/auth/callback";

export const SEED_USAGE = `Usage:
  pnpm portal:seed -- --email <address> [options]

Options:
  --email <address>     Required. The first user of the org.
  --tenant <slug>       Tenant slug, ^[a-z][a-z0-9_]{1,30}$    (default: ${DEFAULT_TENANT})
  --tenant-name <name>  Display name. On a NEW tenant it defaults to the slug; on an
                        existing one it renames the tenant and rewrites
                        branding.product_name, and omitting it changes neither.
  --org <name>          Org display name                        (default: ${DEFAULT_ORG})
  --org-slug <slug>     Org slug                                (default: slugified --org)
  --seat-cap <n>        Hard ceiling on active users            (default: ${DEFAULT_SEAT_CAP})
  --redirect <uri>      Repeatable. Added to the client's redirect allowlist; an existing
                        client keeps the ones it already has and its secret is untouched.
                        https, or http on loopback. Nothing else.
                                                                (default: ${DEFAULT_REDIRECT})
  --client-id <id>      OAuth client id                         (default: <tenant>-web)
  --rotate-secret       Mint a new client secret and print it once.`;

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "::1", "[::1]"]);

function isLoopback(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTNAMES.has(value) || value === "::1") {
    return true;
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}

/**
 * The scheme rule for a registered callback, applied where the row is written.
 *
 * `new URL` alone accepted `javascript:`, `data:` and `file:` — all absolute URIs — and the
 * allowlist this writes into is the one thing between a stolen `client_id` and an authorization
 * code: `/authorize` exact-matches a `redirect_uri` against it and then sends a browser there with
 * the code in the query string. So: https anywhere, http on loopback only, which is the same rule
 * the product applies to its own public origin.
 */
export function assertRedirectUri(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SeedArgsError(`--redirect must be an absolute URI; got ${JSON.stringify(raw)}`);
  }
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && isLoopback(url.hostname)) {
    return;
  }
  throw new SeedArgsError(
    `--redirect must be https, or http on loopback; got ${JSON.stringify(raw)}. ` +
      "A registered callback is exact-matched and then redirected to with an authorization code.",
  );
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  // tenants_slug_format_chk / the same shape for orgs: must start with a letter.
  return /^[a-z]/.test(slug) ? slug : `o_${slug}`;
}

export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const values = new Map<string, string[]>();
  let flagName: string | null = null;

  for (const token of argv) {
    if (token.startsWith("--")) {
      const [name, inline] = token.slice(2).split("=", 2);
      if (inline !== undefined) {
        values.set(name, [...(values.get(name) ?? []), inline]);
        flagName = null;
      } else {
        // Recorded now so a bare flag like --rotate-secret still counts as present.
        values.set(name, values.get(name) ?? []);
        flagName = name;
      }
      continue;
    }
    if (flagName === null) {
      throw new SeedArgsError(`Unexpected argument ${JSON.stringify(token)}.\n\n${SEED_USAGE}`);
    }
    values.set(flagName, [...(values.get(flagName) ?? []), token]);
    flagName = null;
  }

  const single = (name: string): string | undefined => values.get(name)?.[0];

  const email = single("email")?.trim();
  if (!email?.includes("@")) {
    throw new SeedArgsError(`--email <address> is required.\n\n${SEED_USAGE}`);
  }

  const tenantSlug = (single("tenant") ?? DEFAULT_TENANT).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(tenantSlug)) {
    throw new SeedArgsError(
      `--tenant must match ^[a-z][a-z0-9_]{1,30}$ (tenants_slug_format_chk); got ${JSON.stringify(tenantSlug)}`,
    );
  }

  const seatCapRaw = single("seat-cap");
  const seatCap = seatCapRaw === undefined ? DEFAULT_SEAT_CAP : Number(seatCapRaw);
  if (!Number.isInteger(seatCap) || seatCap < 1 || seatCap > 100_000) {
    throw new SeedArgsError(`--seat-cap must be an integer between 1 and 100000; got ${seatCapRaw}`);
  }

  const orgName = (single("org") ?? DEFAULT_ORG).trim();
  const redirects = values.get("redirect") ?? [];
  for (const uri of redirects) {
    assertRedirectUri(uri);
  }

  return Object.freeze({
    email,
    tenantSlug,
    tenantName: single("tenant-name")?.trim() || null,
    orgName,
    orgSlug: (single("org-slug") ?? slugify(orgName)).trim(),
    seatCap,
    redirectUris: Object.freeze(redirects.length > 0 ? [...redirects] : [DEFAULT_REDIRECT]),
    clientId: (single("client-id") ?? `${tenantSlug}-web`).trim(),
    clientName: `${orgName} web`,
    rotateSecret: values.has("rotate-secret"),
  });
}
