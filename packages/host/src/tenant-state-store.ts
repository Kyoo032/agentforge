/**
 * Phase 4 — the storage backend behind a tenant's secrets and gate verdict.
 *
 * Phase 3 lane D gave every tenant its own `settings.enc` and `gateway-gate.json`, under
 * `tenants/<id>/` for a hosted tenant and at the install root for `local-tenant`. That is a
 * per-tenant *file* layout, and on the hosted deploy the filesystem is the fragile part: a
 * container rebuilt without its data volume takes every tenant's key with it, and two app
 * processes behind the proxy write the same file with no lock between them. The database already
 * holds the tenant row, so Phase 4 puts the tenant's state beside it.
 *
 * **The rule, and there is only one:** the backend is chosen by mode, never by tenant.
 * `isServerMode()` → rows in `tenant_state`; anything else → the files lane D placed, at the exact
 * paths lane D placed them. So a desktop data directory is byte-identical before and after this
 * change and the `tenant_state` table simply stays empty there, while on a hosted server no
 * tenant's secrets touch the disk at all. There is no per-tenant branch to get wrong, and no
 * fallback from one backend to the other at read time — a fallback is how a hosted tenant ends up
 * silently reading a file nobody backs up.
 *
 * What is stored is byte for byte what the file held: the sealed envelope
 * (`packages/core/src/crypto/envelope.ts`, wrapped with `getLocalVaultKey()`) for `settings`, and
 * the plain JSON verdict — which carries a key fingerprint and never a key — for `gateway_gate`.
 * The envelope, the wrap key and the payload shape are all unchanged, which is what lets
 * `wrap-key-rotation.ts` treat a row and a file the same way.
 *
 * **Why the row backend is registered here rather than imported here.** `@agentforge/db`'s entry
 * point OPENS the database as an import side effect (`packages/db/src/client.ts:39` — it resolves
 * the file, creates the directory and runs `ensureSchema`). This module is reached from
 * `settings-store.ts`, which is reached from `edit/asr.ts`, which is reached from the ffmpeg doctor:
 * importing the client statically would mean a unit test about where `ffmpeg` lives opening a
 * SQLite file, and `edit/ffmpeg-binary.test.ts` mocks `node:fs` wholesale, so it would not even get
 * that far. `tenant-state-db.ts` holds the import and installs itself from `router.ts`, which every
 * request already goes through. If nothing installed it, server mode THROWS rather than quietly
 * using the files — a silent fall back to a store nobody backs up is the failure this whole module
 * exists to prevent.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ApiError, isServerMode, LOCAL_TENANT_ID, type TenantStateKey } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";
import { assertTenantId, tenantDataDir, TENANTS_DIR } from "./tenant-paths";
import { log } from "./log";

/**
 * The filename each payload has on a desk. These are lane D's paths and they are frozen: an
 * existing desktop install must open with nothing moved, so this map is the one place that may
 * ever say `settings.enc`.
 */
export const TENANT_STATE_FILENAMES: Record<TenantStateKey, string> = {
  settings: "settings.enc",
  gateway_gate: "gateway-gate.json",
};

/**
 * A file the row backend has already taken over, kept rather than deleted. Adoption is a one-way
 * move of somebody's only copy of their key, so the bytes stay on disk under a name nothing reads.
 */
export const ADOPTED_SUFFIX = ".adopted";

/**
 * A stored payload and a cheap token for "has this changed". The token is `statSync().mtimeMs` on
 * a file and `updated_at` on a row; callers only ever compare it to a previous one.
 */
export type TenantStateEntry = { value: string; stamp: string };

export interface TenantStateBackend {
  readonly kind: "file" | "db";
  /** The payload, or null when this tenant has never stored one. Throws only on a real IO fault. */
  read(tenantId: string, key: TenantStateKey): TenantStateEntry | null;
  /** The change token alone, without paying for the payload. Null when there is nothing stored. */
  stamp(tenantId: string, key: TenantStateKey): string | null;
  write(tenantId: string, key: TenantStateKey, value: string): void;
  /** Idempotent: removing what is not there is not an error. */
  remove(tenantId: string, key: TenantStateKey): void;
  /** Every tenant holding a payload of this kind. The rotation drill is the only caller. */
  tenantsWith(key: TenantStateKey): string[];
  /** Where the payload lives, for a log line or an error message. Never the payload itself. */
  describe(tenantId: string, key: TenantStateKey): string;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

/* ------------------------------------------------------------------ file backend (the desktop) */

function statePath(tenantId: string, key: TenantStateKey): string {
  return resolve(tenantDataDir(assertTenantId(tenantId)), TENANT_STATE_FILENAMES[key]);
}

export const fileTenantStateBackend: TenantStateBackend = {
  kind: "file",

  read(tenantId, key) {
    const path = statePath(tenantId, key);
    try {
      // Stat first, so the stamp belongs to the bytes that come back rather than to a write that
      // landed between the two calls: a stamp taken after the read could be newer than the content.
      const stamp = String(statSync(path).mtimeMs);
      return { value: readFileSync(path, "utf8"), stamp };
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  },

  stamp(tenantId, key) {
    try {
      return String(statSync(statePath(tenantId, key)).mtimeMs);
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  },

  write(tenantId, key, value) {
    // Temp file then rename, which is what `saveGateState` already did: a crash mid-write must not
    // leave half an envelope where the whole one was. `settings.enc` was written in place before
    // this and is no worse off for the change.
    const path = statePath(tenantId, key);
    const temp = `${path}.tmp`;
    mkdirSync(tenantDataDir(tenantId), { recursive: true });
    writeFileSync(temp, value, "utf8");
    renameSync(temp, path);
  },

  remove(tenantId, key) {
    try {
      unlinkSync(statePath(tenantId, key));
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  },

  tenantsWith(key) {
    const root = localDataDir();
    const found: string[] = [];
    // The local tenant's root IS the install root (lane D's one rule), so its payload is the bare
    // filename at the top and it is never listed under `tenants/`.
    if (existsSync(resolve(root, TENANT_STATE_FILENAMES[key]))) {
      found.push(LOCAL_TENANT_ID);
    }
    let entries: string[];
    try {
      entries = readdirSync(resolve(root, TENANTS_DIR), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      if (isMissingFile(error)) {
        return found;
      }
      throw error;
    }
    for (const tenantId of entries) {
      if (existsSync(resolve(root, TENANTS_DIR, tenantId, TENANT_STATE_FILENAMES[key]))) {
        found.push(tenantId);
      }
    }
    return found;
  },

  describe(tenantId, key) {
    return statePath(tenantId, key);
  },
};

/* ------------------------------------------------------------- row backend (the hosted server) */

/**
 * Tenants whose legacy file this process has already looked at, so adoption is attempted once per
 * tenant and key rather than on every settings read of every request.
 */
const adoptionChecked = new Set<string>();

/**
 * Take over a per-tenant file written before this phase.
 *
 * Phase 3 shipped hosted tenants writing `tenants/<id>/settings.enc`. A server that upgrades into
 * Phase 4 with those files on its data volume must not read back an empty key and send the tenant
 * to onboarding, so the first read for a tenant that has no row imports the file's bytes verbatim
 * — the envelope is unchanged, so there is nothing to re-encrypt — and renames the file aside.
 *
 * The rename is what makes this safe to run on every boot: once the row exists the file can no
 * longer shadow it, and the bytes are still on disk under `.adopted` if the move has to be undone
 * by hand. Never deletes.
 */
function adoptLegacyFile(tenantId: string, key: TenantStateKey): TenantStateEntry | null {
  const slot = `${tenantId}:${key}`;
  if (adoptionChecked.has(slot)) {
    return null;
  }
  adoptionChecked.add(slot);
  const entry = fileTenantStateBackend.read(tenantId, key);
  if (!entry) {
    return null;
  }
  dbTenantStateBackend.write(tenantId, key, entry.value);
  const path = fileTenantStateBackend.describe(tenantId, key);
  try {
    renameSync(path, `${path}${ADOPTED_SUFFIX}`);
  } catch (error) {
    // The row is written, which is the part that matters. A file that could not be renamed is read
    // again on the next boot and adopted again onto the same row, which is idempotent.
    // `payload`, not `key`: the logger drops any field whose NAME contains a credential word, so a
    // field called `key` would be written as "[dropped]" and the line would not say what was moved.
    log.warn("tenant_state_adopted_file_not_renamed", {
      tenantId,
      payload: key,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  log.info("tenant_state_adopted_file", { tenantId, payload: key });
  return dbTenantStateBackend.read(tenantId, key);
}

/** Test seam: forget which tenants have been checked, so a suite can re-drive adoption. */
export function resetTenantStateAdoptionForTests(): void {
  adoptionChecked.clear();
}

/**
 * The narrow slice of a `better-sqlite3` connection this module needs. Declared rather than
 * imported so nothing here depends on `@agentforge/db`'s import-time database open; see the note at
 * the top of the file.
 */
export type TenantStateSql = {
  prepare(source: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
};

let connection: TenantStateSql | null = null;

/** Called by `tenant-state-db.ts`, which `router.ts` pulls in. Idempotent. */
export function registerTenantStateSql(sql: TenantStateSql): void {
  connection = sql;
}

/**
 * The connection `registerTenantStateSql` installed, for the one other caller that needs it outside
 * a request: the wrap-key rotation, which re-seals the session refresh tokens on `auth_sessions`
 * through the same connection it re-seals `tenant_state` through. Fails closed like every read here.
 */
export function registeredTenantStateSql(): TenantStateSql {
  return requireSql();
}

/** Test seam: go back to "nothing registered", which is what a fresh process looks like. */
export function resetTenantStateSqlForTests(): void {
  connection = null;
}

function requireSql(): TenantStateSql {
  if (!connection) {
    throw new ApiError(
      "tenant_state_backend_missing",
      "The hosted tenant state backend was never installed, so this tenant's settings cannot be read " +
        "or written. `packages/host/src/router.ts` imports `tenant-state-db.ts`, which installs it.",
      500,
    );
  }
  return connection;
}

export const dbTenantStateBackend: TenantStateBackend = {
  kind: "db",

  read(tenantId, key) {
    const row = requireSql()
      .prepare("SELECT value, updated_at FROM tenant_state WHERE tenant_id = ? AND key = ?")
      .get(assertTenantId(tenantId), key) as { value: string; updated_at: number } | undefined;
    if (!row) {
      return adoptLegacyFile(tenantId, key);
    }
    return { value: row.value, stamp: String(row.updated_at) };
  },

  stamp(tenantId, key) {
    const row = requireSql()
      .prepare("SELECT updated_at FROM tenant_state WHERE tenant_id = ? AND key = ?")
      .get(assertTenantId(tenantId), key) as { updated_at: number } | undefined;
    return row ? String(row.updated_at) : null;
  },

  write(tenantId, key, value) {
    // `updated_at` is the cache stamp, so it has to move on every write even when the bytes are
    // identical — two saves inside the same millisecond would otherwise read as "unchanged" and
    // serve a stale decrypt from the cache. `max(?, updated_at + 1)` makes the column strictly
    // increasing per row without depending on the clock's resolution.
    requireSql()
      .prepare(
        `INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET
           value = excluded.value,
           updated_at = max(excluded.updated_at, tenant_state.updated_at + 1)`,
      )
      .run(assertTenantId(tenantId), key, value, Date.now());
  },

  remove(tenantId, key) {
    requireSql().prepare("DELETE FROM tenant_state WHERE tenant_id = ? AND key = ?").run(assertTenantId(tenantId), key);
  },

  tenantsWith(key) {
    const rows = requireSql()
      .prepare("SELECT tenant_id FROM tenant_state WHERE key = ? ORDER BY tenant_id")
      .all(key) as Array<{ tenant_id: string }>;
    return rows.map((row) => row.tenant_id);
  },

  describe(tenantId, key) {
    return `tenant_state(${tenantId}, ${key})`;
  },
};

/**
 * The backend this process uses. Resolved per call rather than once at import: the test suites and
 * `apps/web` both flip `AGENTFORGE_SERVER` after the module graph is loaded, and a backend frozen
 * at import time would answer for the mode the process started in rather than the one it is in.
 */
export function tenantStateBackend(): TenantStateBackend {
  return isServerMode() ? dbTenantStateBackend : fileTenantStateBackend;
}
