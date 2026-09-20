/**
 * Phase 4 — the two per-tenant payloads that moved behind a storage backend.
 *
 * Lane D gave every tenant its own `settings.enc` and `gateway-gate.json` under `tenants/<id>/`.
 * Phase 4 keeps those files on the desktop and puts the same two payloads in `tenant_state` rows on
 * the hosted server, so the key names live here rather than being spelled out at each backend: the
 * file backend maps a key to a filename, the row backend maps it to the `key` column, and a
 * migration or a rotation drill that has to name them has one list to read.
 *
 * Deliberately NOT the filenames. `settings.enc` is a desktop path that predates tenancy and has to
 * stay exactly where it is; `settings` is what the payload IS. A column that carried the filename
 * would make the row backend a description of the file layout rather than an alternative to it.
 */
export const TENANT_STATE_KEYS = ["settings", "gateway_gate"] as const;

export type TenantStateKey = (typeof TENANT_STATE_KEYS)[number];

export function isTenantStateKey(value: unknown): value is TenantStateKey {
  return typeof value === "string" && (TENANT_STATE_KEYS as readonly string[]).includes(value);
}
