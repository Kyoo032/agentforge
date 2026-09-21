/**
 * audit_log — append-only, and enforced as such by a trigger in `0003_billing_and_usage.sql`,
 * so there is no update and no delete here to write.
 *
 * `tenant_id` is NOT NULL in that file, which is why `AppendAuditInput.tenantId` is required:
 * an event whose tenant has not been resolved yet has nowhere to go, and inventing a tenant for
 * it would be worse than not writing it.
 */
import type { PoolClient } from "pg";
import type { PortalOps } from "../types";
import { type Row, toAuditEntry } from "./rows";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function auditOps(client: PoolClient): PortalOps["audit"] {
  return {
    async append(input) {
      const { rows } = await client.query<Row>(
        `INSERT INTO audit_log (tenant_id, org_id, actor_kind, actor_user_id, action, target_kind,
                                target_id, reason_code, before, after, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::inet, $12)
         RETURNING *`,
        [
          input.tenantId,
          input.orgId ?? null,
          input.actorKind,
          input.actorUserId ?? null,
          input.action,
          input.targetKind ?? null,
          input.targetId ?? null,
          input.reasonCode ?? null,
          input.before ? JSON.stringify(input.before) : null,
          input.after ? JSON.stringify(input.after) : null,
          input.ip ?? null,
          input.userAgent ?? null,
        ],
      );
      return toAuditEntry(rows[0]);
    },

    async list(filter = {}) {
      const limit = Math.min(Math.max(1, filter.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
      const { rows } = await client.query<Row>(
        `SELECT * FROM audit_log
          WHERE ($1::uuid IS NULL OR tenant_id = $1)
            AND ($2::text IS NULL OR action = $2)
          ORDER BY seq DESC
          LIMIT $3`,
        [filter.tenantId ?? null, filter.action ?? null, limit],
      );
      return Object.freeze(rows.map(toAuditEntry));
    },
  };
}
