/**
 * Which product name the sign-in mail prints.
 *
 * The mail used to carry a product-name constant of its own while every page of the same sign-in
 * printed a different one -- two names for one flow, and the one the user reads first is the one in
 * their inbox. There is now a single order:
 *
 *   1. the tenant's `tenant_config.branding.product_name`, which is what a white-labelled
 *      deployment sets;
 *   2. the tenant's own display name (`tenants.name`);
 *   3. the portal's product copy -- `locales/<locale>/portal.json`, key `product`, applied by
 *      `mail/templates.ts`, which is the exact string every page prints.
 *
 * **A name that only repeats the slug is not a name.** `src/seed/args.ts` defaults `--tenant-name`
 * to the slug and `src/seed/seed.ts` copies that into `branding.product_name`, so "the operator
 * chose a display name" and "the operator chose nothing" are the same row. Printing the
 * placeholder would put a bare lowercase slug in a subject line under a page printing a real name,
 * so a value that differs from the slug only by case, spaces, hyphens or underscores is treated as
 * absent and step 3 applies.
 */
import type { JsonObject } from "../store/types";

/** Longer than this is not a product name; it is something that got into the column. */
const MAX_PRODUCT_NAME_LENGTH = 120;

export interface TenantNaming {
  readonly slug: string;
  readonly name: string;
}

/** Case, spaces, hyphens and underscores removed -- what makes "Acme Co" and "acme-co" one. */
function slugKey(value: string): string {
  return value.toLowerCase().replace(/[\s._-]+/g, "");
}

function usable(value: unknown, slug: string): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_PRODUCT_NAME_LENGTH) {
    return null;
  }
  return slugKey(trimmed) === slugKey(slug) ? null : trimmed;
}

/**
 * The tenant's own name for itself, or `null` when it has not chosen one. `null` is not an error:
 * the caller leaves `productName` unset and the mail template falls back to the portal's copy.
 */
export function tenantProductName(
  tenant: TenantNaming | null,
  branding: JsonObject | null | undefined,
): string | null {
  if (!tenant) {
    return null;
  }
  return usable(branding?.product_name, tenant.slug) ?? usable(tenant.name, tenant.slug);
}
