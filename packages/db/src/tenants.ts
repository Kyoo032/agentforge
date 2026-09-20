import { LOCAL_TENANT_ID } from "@agentforge/core";
import { eq } from "drizzle-orm";
import type { Database } from "./client";
import { tenants } from "./schema";

export type TenantRow = typeof tenants.$inferSelect;

export type ProvisionTenantInput = {
  /** The portal's own `tenants.id`. Never generated here — the portal is the authority. */
  id: string;
  slug: string;
  name: string;
  status?: "active" | "inactive";
};

/**
 * Write the host's copy of a portal tenant, idempotently.
 *
 * Phase 3 lane B only defines it; nothing calls it yet. Lane C owns the seam that resolves a
 * tenant from the session, and this is what it calls on a first sign-in so a session whose
 * `tenant_id` the host has never seen gets a row instead of a 500.
 *
 * Who gets to call it is still open (first sign-in, an operator, or the billing webhook — spec §8
 * question 2), so this deliberately takes an already-authenticated portal tenant rather than
 * deciding the policy: it creates nothing on its own and cannot be reached from a route yet.
 */
export async function ensureTenant(db: Database, input: ProvisionTenantInput): Promise<TenantRow> {
  const [existing] = await db.select().from(tenants).where(eq(tenants.id, input.id)).limit(1);
  if (existing) {
    return existing;
  }
  const [row] = await db
    .insert(tenants)
    .values({
      id: input.id,
      slug: input.slug,
      name: input.name,
      status: input.status ?? "active",
    })
    .returning();
  return row;
}

export async function getTenantById(db: Database, id: string): Promise<TenantRow | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return row ?? null;
}

/** The tenant every desktop and webdev database resolves to. Created by migration 0015. */
export async function getLocalTenant(db: Database): Promise<TenantRow | null> {
  return getTenantById(db, LOCAL_TENANT_ID);
}
