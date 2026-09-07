import type Database from "better-sqlite3";
import { sql } from "@agentforge/db";
import { getLocalVaultKey } from "@agentforge/db/vault-key";
import { ApiError, openPayload, sealPayload, type TenantContext } from "@agentforge/core";
import {
  artifactMetaSchema,
  isArtifactKind,
  isArtifactMime,
  isArtifactMode,
  type ArtifactKind,
  type ArtifactMeta,
  type ArtifactMime,
  type ArtifactMode,
  type ArtifactRecord,
  type ArtifactSummary,
} from "@agentforge/core/artifacts";

/** Hard cap on a single artifact body (dossiers, analyses, briefs are text). */
export const ARTIFACT_BODY_MAX_BYTES = 4 * 1024 * 1024;
export const ARTIFACT_TITLE_MAX = 200;
export const ARTIFACT_LIST_LIMIT = 200;

export type CreateArtifactInput = {
  mode: ArtifactMode;
  kind: ArtifactKind;
  title: string;
  mime: ArtifactMime;
  body: string;
  meta?: ArtifactMeta;
};

export type ArtifactStore = {
  create(tenant: TenantContext, input: CreateArtifactInput): ArtifactRecord;
  list(tenant: TenantContext, mode?: ArtifactMode): ArtifactSummary[];
  get(tenant: TenantContext, id: string): ArtifactRecord | null;
  remove(tenant: TenantContext, id: string): boolean;
};

type Row = {
  id: string;
  workspace_id: string;
  mode: string;
  kind: string;
  title: string;
  mime: string;
  body: string;
  meta: string;
  size_bytes: number;
  created_at: number;
  updated_at: number;
};

function readMeta(raw: string): ArtifactMeta {
  try {
    const parsed = artifactMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function summaryFromRow(row: Row): ArtifactSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    mode: isArtifactMode(row.mode) ? row.mode : "documents",
    kind: isArtifactKind(row.kind) ? row.kind : "draft",
    title: row.title,
    mime: isArtifactMime(row.mime) ? row.mime : "text/markdown",
    meta: readMeta(row.meta),
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateInput(input: CreateArtifactInput): CreateArtifactInput {
  if (!isArtifactMode(input.mode) || !isArtifactKind(input.kind) || !isArtifactMime(input.mime)) {
    throw new ApiError("invalid_request", "Artifact mode, kind, or mime is not allowed", 400);
  }
  const title = input.title.trim().slice(0, ARTIFACT_TITLE_MAX);
  if (!title) {
    throw new ApiError("invalid_request", "Artifact title is required", 400);
  }
  if (typeof input.body !== "string" || !input.body.trim()) {
    throw new ApiError("invalid_request", "Artifact body is required", 400);
  }
  if (Buffer.byteLength(input.body, "utf8") > ARTIFACT_BODY_MAX_BYTES) {
    throw new ApiError("invalid_request", "Artifact body exceeds the 4 MB cap", 413);
  }
  const meta = artifactMetaSchema.safeParse(input.meta ?? {});
  return { ...input, title, meta: meta.success ? meta.data : {} };
}

/**
 * Repository over the kernel `artifacts` table. Bodies are sealed with the
 * local vault key the same way chat messages are; metadata stays queryable.
 */
export function createArtifactStore(db: Database.Database, keyProvider: () => Buffer): ArtifactStore {
  const seal = (body: string): string => JSON.stringify(sealPayload(body, keyProvider()));
  const open = (stored: string): string => {
    try {
      const value = openPayload<unknown>(JSON.parse(stored), keyProvider());
      return typeof value === "string" ? value : stored;
    } catch {
      return stored;
    }
  };

  return {
    create(tenant, rawInput) {
      const input = validateInput(rawInput);
      const now = Date.now();
      const id = crypto.randomUUID();
      const sizeBytes = Buffer.byteLength(input.body, "utf8");
      db.prepare(
        `INSERT INTO artifacts (id, workspace_id, mode, kind, title, mime, body, meta, size_bytes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        tenant.workspaceId,
        input.mode,
        input.kind,
        input.title,
        input.mime,
        seal(input.body),
        JSON.stringify(input.meta ?? {}),
        sizeBytes,
        now,
        now,
      );
      return {
        id,
        workspaceId: tenant.workspaceId,
        mode: input.mode,
        kind: input.kind,
        title: input.title,
        mime: input.mime,
        meta: input.meta ?? {},
        sizeBytes,
        createdAt: now,
        updatedAt: now,
        body: input.body,
      };
    },

    list(tenant, mode) {
      const rows = mode
        ? (db
            .prepare(
              `SELECT id, workspace_id, mode, kind, title, mime, '' AS body, meta, size_bytes, created_at, updated_at
               FROM artifacts WHERE workspace_id = ? AND mode = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(tenant.workspaceId, mode, ARTIFACT_LIST_LIMIT) as Row[])
        : (db
            .prepare(
              `SELECT id, workspace_id, mode, kind, title, mime, '' AS body, meta, size_bytes, created_at, updated_at
               FROM artifacts WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(tenant.workspaceId, ARTIFACT_LIST_LIMIT) as Row[]);
      return rows.map(summaryFromRow);
    },

    get(tenant, id) {
      const row = db.prepare("SELECT * FROM artifacts WHERE workspace_id = ? AND id = ?").get(tenant.workspaceId, id) as
        | Row
        | undefined;
      if (!row) {
        return null;
      }
      return { ...summaryFromRow(row), body: open(row.body) };
    },

    remove(tenant, id) {
      const result = db.prepare("DELETE FROM artifacts WHERE workspace_id = ? AND id = ?").run(tenant.workspaceId, id);
      return result.changes > 0;
    },
  };
}

let defaultStore: ArtifactStore | null = null;

/** Store bound to the app database and the local vault key. */
export function artifactStore(): ArtifactStore {
  if (!defaultStore) {
    defaultStore = createArtifactStore(sql, getLocalVaultKey);
  }
  return defaultStore;
}

export function requireArtifact(tenant: TenantContext, id: string): ArtifactRecord {
  const record = artifactStore().get(tenant, id);
  if (!record) {
    throw new ApiError("not_found", "Artifact not found", 404);
  }
  return record;
}
