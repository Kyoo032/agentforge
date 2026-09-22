/**
 * `pnpm portal:seed` — the first tenant, org, user and OAuth client on a fresh database.
 *
 * Idempotent by design, because the operator will run it again: every step looks for what it
 * would create and adopts it instead. The one thing that cannot be idempotent is the client
 * secret — it exists as plaintext for the length of one `console.log` — so a re-run reports that
 * the client is already there and says how to rotate, rather than silently printing a secret that
 * does not match the stored hash.
 *
 * There is no self-serve sign-up (`web-phase9-portal-login.md`, "First user locally"), so this is
 * the only way a user row comes into existence.
 */
import { randomUUID } from "node:crypto";
import { normaliseEmail, randomToken } from "../crypto";
import type { PortalStore } from "../store/types";
import type { SeedArgs } from "./args";

export interface SeedResult {
  readonly tenantId: string;
  readonly tenantSlug: string;
  /** The tenant's display name as it stands after this run. */
  readonly tenantName: string;
  /** True only when THIS run changed that name. A rename is a change, not a creation. */
  readonly tenantRenamed: boolean;
  readonly orgId: string;
  readonly orgSlug: string;
  readonly userId: string;
  readonly email: string;
  readonly seatCap: number;
  readonly clientId: string;
  readonly redirectUris: readonly string[];
  /**
   * The `--redirect` values this run registered that were not registered before — empty on a first
   * run (they all arrive with the client) and empty on a re-run that asked for nothing new.
   */
  readonly redirectsAdded: readonly string[];
  /** Present only when a secret was actually minted: a first run, or `--rotate-secret`. */
  readonly clientSecret: string | null;
  readonly created: {
    readonly tenant: boolean;
    readonly org: boolean;
    readonly user: boolean;
    readonly client: boolean;
    readonly secretRotated: boolean;
  };
}

export async function runSeed(store: PortalStore, args: SeedArgs): Promise<SeedResult> {
  const email = normaliseEmail(args.email);

  // The tenant id has to exist before the transaction that inserts it: the RLS policy on `tenants`
  // is `WITH CHECK (id = app_tenant_id())`, so the scope and the row are the same value.
  const existingTenantId = await store.resolve.bySlug(args.tenantSlug);
  const tenantId = existingTenantId ?? randomUUID();

  return store.tx(tenantId, async (ops) => {
    // A new tenant with no --tenant-name keeps the slug as its display name. `otp/product-name.ts`
    // treats that as "no name chosen" on purpose, so the mail falls back to the portal's own copy
    // rather than putting a lowercase slug in a subject line.
    const newTenantName = args.tenantName ?? args.tenantSlug;
    const existing = await ops.tenants.findBySlug(args.tenantSlug);
    const created = existing
      ? null
      : await ops.tenants.create({ id: tenantId, slug: args.tenantSlug, name: newTenantName });
    const createdTenant = existingTenantId === null;

    if (createdTenant) {
      // A tenant with no config row would 500 the first /tenant/config; give it the defaults.
      await ops.tenantConfig.upsert({
        tenantId: tenantId,
        branding: { product_name: newTenantName },
        modelAllowlist: [],
        featureFlags: { allow_byo_key: true, sso_provider: null },
      });
    }

    // Renaming an EXISTING tenant, and only when a name was actually asked for. Both places the
    // name lives are written together: `otp/product-name.ts` reads `branding.product_name` FIRST,
    // so updating `tenants.name` alone would leave the mail printing the old one out of a row
    // nobody thought to look at. The rest of `branding` is merged, never replaced -- the upsert
    // writes the whole JSON column, so a key this lane knows nothing about has to be carried over.
    const wantsRename = !createdTenant && args.tenantName !== null && existing?.name !== args.tenantName;
    let tenant = created ?? existing;
    if (wantsRename && args.tenantName !== null && tenant) {
      tenant = (await ops.tenants.setName(tenant.id, args.tenantName)) ?? tenant;
      const config = await ops.tenantConfig.get(tenant.id);
      await ops.tenantConfig.upsert({
        tenantId: tenant.id,
        branding: { ...(config?.branding ?? {}), product_name: args.tenantName },
      });
    }
    if (!tenant) {
      throw new Error(`Tenant ${args.tenantSlug} could not be created or found.`);
    }

    const existingOrg = await ops.orgs.findBySlug(tenant.id, args.orgSlug);
    const org =
      existingOrg ??
      (await ops.orgs.create({
        tenantId: tenant.id,
        name: args.orgName,
        slug: args.orgSlug,
        seatCap: args.seatCap,
      }));
    // A re-run with a different --seat-cap is a deliberate change, not a collision.
    const seatedOrg =
      existingOrg && existingOrg.seatCap !== args.seatCap
        ? ((await ops.orgs.setSeatCap(existingOrg.id, args.seatCap)) ?? existingOrg)
        : org;

    const existingUser = await ops.users.findByEmail(tenant.id, email);
    const user =
      existingUser ??
      (await ops.users.create({
        tenantId: tenant.id,
        orgId: seatedOrg.id,
        email,
        // Seeded users are active: there is no invitation flow to move them out of `invited`.
        status: "active",
        role: "owner",
      }));

    const existingClient = await ops.oauthClients.findByClientId(args.clientId);
    let clientSecret: string | null = null;
    let secretRotated = false;
    let redirectsAdded: readonly string[] = [];

    let client = existingClient;
    if (!client) {
      clientSecret = randomToken();
      client = await ops.oauthClients.create({
        clientId: args.clientId,
        tenantId: tenant.id,
        name: args.clientName,
        secret: clientSecret,
        redirectUris: args.redirectUris,
      });
    } else {
      if (args.rotateSecret) {
        clientSecret = randomToken();
        client = (await ops.oauthClients.rotateSecret(args.clientId, clientSecret)) ?? client;
        secretRotated = true;
      }
      // Registering a callback is not rotating a secret. The review instance is seeded against
      // https://localhost:3443/auth/callback and then has to learn the tunnel's callback as well,
      // while AGENTFORGE_PORTAL_CLIENT_SECRET in review.env stays untouched — so this runs whether
      // or not --rotate-secret was passed, and the two are independent.
      //
      // ADDITIVE, never a replacement. `--redirect` defaults to the localhost callback when it is
      // omitted, so treating the argument as the whole list would quietly deregister the public
      // callback every time somebody re-seeded without repeating it — and the next sign-in would
      // fail the exact-match allowlist with no clue as to why. Removing one is a deliberate act
      // that belongs in a tool that says so, not a side effect of a default.
      const known = new Set(client.redirectUris);
      const added = args.redirectUris.filter((uri) => !known.has(uri));
      if (added.length > 0) {
        client = (await ops.oauthClients.setRedirectUris(args.clientId, [...client.redirectUris, ...added])) ?? client;
        redirectsAdded = Object.freeze([...added]);
      }
    }

    await ops.audit.append({
      tenantId: tenant.id,
      orgId: seatedOrg.id,
      actorKind: "system",
      action: "portal.seeded",
      targetKind: "org",
      targetId: seatedOrg.id,
      after: {
        tenant_slug: tenant.slug,
        tenant_renamed: wantsRename,
        org_slug: seatedOrg.slug,
        seat_cap: seatedOrg.seatCap,
        client_id: client.clientId,
        secret_rotated: secretRotated,
        redirects_added: [...redirectsAdded],
      },
    });

    return Object.freeze({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      tenantRenamed: wantsRename,
      orgId: seatedOrg.id,
      orgSlug: seatedOrg.slug,
      userId: user.id,
      email: user.email,
      seatCap: seatedOrg.seatCap,
      clientId: client.clientId,
      redirectUris: client.redirectUris,
      redirectsAdded,
      clientSecret,
      created: {
        tenant: createdTenant,
        org: existingOrg === null,
        user: existingUser === null,
        client: existingClient === null,
        secretRotated,
      },
    });
  });
}

/** What the CLI prints. Kept here so the seed's one-time-secret rule is testable. */
export function formatSeedReport(result: SeedResult): string {
  const tenantState = result.created.tenant
    ? "  [created]"
    : result.tenantRenamed
      ? "  [renamed]"
      : "  [existing]";
  const lines: string[] = [
    `tenant  ${result.tenantSlug}  (${result.tenantId})${tenantState}`,
    `        name: ${result.tenantName}`,
    `org     ${result.orgSlug}  (${result.orgId})  seat_cap=${result.seatCap}${result.created.org ? "  [created]" : "  [existing]"}`,
    `user    ${result.email}  (${result.userId})${result.created.user ? "  [created]" : "  [existing]"}`,
    `client  ${result.clientId}${result.created.client ? "  [created]" : "  [existing]"}`,
    `        redirect_uris: ${result.redirectUris.join(", ")}`,
    "",
  ];

  if (result.redirectsAdded.length > 0) {
    lines.push(
      `Registered ${result.redirectsAdded.length} new redirect_uri, leaving the client secret alone:`,
      ...result.redirectsAdded.map((uri) => `    + ${uri}`),
      "",
    );
  }

  if (result.clientSecret) {
    lines.push(
      result.created.client
        ? "Client secret — shown once, and never again. Put it in AGENTFORGE_PORTAL_CLIENT_SECRET:"
        : "Client secret rotated — shown once. Update AGENTFORGE_PORTAL_CLIENT_SECRET now:",
      "",
      `    ${result.clientSecret}`,
      "",
    );
  } else {
    lines.push(
      `The OAuth client ${result.clientId} already exists and only its sha256 is stored, so the`,
      "secret cannot be shown again. To replace it:",
      "",
      `    pnpm portal:seed -- --email ${result.email} --tenant ${result.tenantSlug} --rotate-secret`,
      "",
      "That mints a new secret, prints it once, and invalidates the old one immediately.",
      "",
    );
  }

  return lines.join("\n");
}
