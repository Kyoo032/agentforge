/** tenants, tenant_config, orgs, users — the rows every other table hangs off. */
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { normaliseEmail } from "../../crypto";
import type { PortalOps } from "../types";
import { type Row, toOrg, toTenant, toTenantConfig, toUser } from "./rows";

function first(rows: Row[]): Row | null {
  return rows.length > 0 ? rows[0] : null;
}

export function tenantsOps(client: PoolClient): PortalOps["tenants"] {
  return {
    async create(input) {
      const { rows } = await client.query<Row>(
        `INSERT INTO tenants (id, slug, name, status, residency)
         VALUES ($1, $2, $3, COALESCE($4, 'active'), COALESCE($5, 'id-jakarta'))
         RETURNING *`,
        [input.id ?? randomUUID(), input.slug, input.name, input.status ?? null, input.residency ?? null],
      );
      return toTenant(rows[0]);
    },
    async findById(id) {
      const { rows } = await client.query<Row>(`SELECT * FROM tenants WHERE id = $1`, [id]);
      const row = first(rows);
      return row ? toTenant(row) : null;
    },
    async findBySlug(slug) {
      const { rows } = await client.query<Row>(`SELECT * FROM tenants WHERE slug = $1`, [slug]);
      const row = first(rows);
      return row ? toTenant(row) : null;
    },
    async setName(id, name) {
      const { rows } = await client.query<Row>(
        `UPDATE tenants SET name = $2::text WHERE id = $1 RETURNING *`,
        [id, name],
      );
      const row = first(rows);
      return row ? toTenant(row) : null;
    },
    async setStatus(id, status) {
      const { rows } = await client.query<Row>(
        `UPDATE tenants
            SET status = $2::text,
                suspended_at = CASE WHEN $2::text = 'suspended' THEN COALESCE(suspended_at, now()) ELSE NULL END
          WHERE id = $1
          RETURNING *`,
        [id, status],
      );
      const row = first(rows);
      return row ? toTenant(row) : null;
    },
  };
}

export function tenantConfigOps(client: PoolClient): PortalOps["tenantConfig"] {
  return {
    async get(tenantId) {
      const { rows } = await client.query<Row>(`SELECT * FROM tenant_config WHERE tenant_id = $1`, [
        tenantId,
      ]);
      const row = first(rows);
      return row ? toTenantConfig(row) : null;
    },
    async upsert(input) {
      // version is bumped on every write, which is what lets /tenant/config answer 304-style.
      const { rows } = await client.query<Row>(
        `INSERT INTO tenant_config (tenant_id, branding, model_allowlist, feature_flags)
         VALUES ($1, COALESCE($2::jsonb, '{}'::jsonb), COALESCE($3::jsonb, '[]'::jsonb),
                 COALESCE($4::jsonb, '{}'::jsonb))
         ON CONFLICT (tenant_id) DO UPDATE
           SET branding        = COALESCE($2::jsonb, tenant_config.branding),
               model_allowlist = COALESCE($3::jsonb, tenant_config.model_allowlist),
               feature_flags   = COALESCE($4::jsonb, tenant_config.feature_flags),
               version         = tenant_config.version + 1,
               updated_at      = now()
         RETURNING *`,
        [
          input.tenantId,
          input.branding ? JSON.stringify(input.branding) : null,
          input.modelAllowlist ? JSON.stringify(input.modelAllowlist) : null,
          input.featureFlags ? JSON.stringify(input.featureFlags) : null,
        ],
      );
      return toTenantConfig(rows[0]);
    },
  };
}

export function orgsOps(client: PoolClient): PortalOps["orgs"] {
  return {
    async create(input) {
      const seatCap = input.seatCap ?? 20;
      const { rows } = await client.query<Row>(
        `INSERT INTO orgs (tenant_id, name, slug, plan, seat_cap, seat_band, currency,
                           billing_email, feature_flags)
         -- Every parameter that appears in more than one expression is cast explicitly: Postgres
         -- otherwise deduces a type per use site and refuses the mismatch.
         VALUES ($1::uuid, $2, $3, COALESCE($4, 'free'), $5::integer,
                 GREATEST($5::integer, COALESCE($6::integer, $5::integer)),
                 COALESCE($7, 'USD'), $8, COALESCE($9::jsonb, '{}'::jsonb))
         RETURNING *`,
        [
          input.tenantId,
          input.name,
          input.slug,
          input.plan ?? null,
          seatCap,
          input.seatBand ?? null,
          input.currency ?? null,
          input.billingEmail ?? null,
          input.featureFlags ? JSON.stringify(input.featureFlags) : null,
        ],
      );
      return toOrg(rows[0]);
    },
    async findById(id) {
      const { rows } = await client.query<Row>(`SELECT * FROM orgs WHERE id = $1`, [id]);
      const row = first(rows);
      return row ? toOrg(row) : null;
    },
    async findBySlug(tenantId, slug) {
      const { rows } = await client.query<Row>(
        `SELECT * FROM orgs WHERE tenant_id = $1 AND slug = $2`,
        [tenantId, slug],
      );
      const row = first(rows);
      return row ? toOrg(row) : null;
    },
    async setStatus(id, status) {
      // orgs_past_due_chk ties past_due_since to the status, so both move together or neither does.
      const { rows } = await client.query<Row>(
        `UPDATE orgs
            SET status = $2::text,
                past_due_since = CASE WHEN $2::text = 'past_due' THEN COALESCE(past_due_since, now()) ELSE NULL END,
                suspended_at   = CASE WHEN $2::text = 'suspended' THEN COALESCE(suspended_at, now()) ELSE suspended_at END
          WHERE id = $1
          RETURNING *`,
        [id, status],
      );
      const row = first(rows);
      return row ? toOrg(row) : null;
    },
    async setSeatCap(id, seatCap) {
      // orgs_seat_band_chk wants seat_band >= seat_cap, so raising the cap raises the band with it.
      const { rows } = await client.query<Row>(
        `UPDATE orgs SET seat_cap = $2::integer, seat_band = GREATEST(seat_band, $2::integer)
          WHERE id = $1 RETURNING *`,
        [id, seatCap],
      );
      const row = first(rows);
      return row ? toOrg(row) : null;
    },
    async countActiveUsers(orgId) {
      const { rows } = await client.query<{ n: number }>(`SELECT count_active_users($1) AS n`, [orgId]);
      return Number(rows[0]?.n ?? 0);
    },
  };
}

export function usersOps(client: PoolClient): PortalOps["users"] {
  return {
    async create(input) {
      const { rows } = await client.query<Row>(
        `INSERT INTO users (tenant_id, org_id, email, display_name, status, role)
         VALUES ($1, $2, $3, $4, COALESCE($5, 'invited'), COALESCE($6, 'member'))
         RETURNING *`,
        [
          input.tenantId,
          input.orgId,
          normaliseEmail(input.email),
          input.displayName ?? null,
          input.status ?? null,
          input.role ?? null,
        ],
      );
      return toUser(rows[0]);
    },
    async findById(id) {
      const { rows } = await client.query<Row>(`SELECT * FROM users WHERE id = $1`, [id]);
      const row = first(rows);
      return row ? toUser(row) : null;
    },
    async findByEmail(tenantId, email) {
      const { rows } = await client.query<Row>(
        `SELECT * FROM users WHERE tenant_id = $1 AND email = $2`,
        [tenantId, normaliseEmail(email)],
      );
      const row = first(rows);
      return row ? toUser(row) : null;
    },
    async setStatus(id, status) {
      const { rows } = await client.query<Row>(
        `UPDATE users
            SET status = $2::text,
                deactivated_at = CASE WHEN $2::text = 'disabled' THEN COALESCE(deactivated_at, now()) ELSE NULL END
          WHERE id = $1
          RETURNING *`,
        [id, status],
      );
      const row = first(rows);
      return row ? toUser(row) : null;
    },
  };
}
