import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { deleteArtifactsByOwner } from "./knowledge";

/**
 * `deleteArtifactsByOwner` narrows a DELETE with a `LIKE` built from a request-supplied id
 * (a dataset id, a matter id). `%` and `_` are wildcards inside a LIKE pattern, so an id
 * carrying either used to widen the prefilter across the whole workspace's artifacts — only
 * the parsed-meta check downstream kept the widened scan from deleting somebody else's card.
 * Both layers are pinned here: the pattern escapes, and the exact check still runs.
 */

const TENANT: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-owner",
  workspaceId: "ws-owner",
  userId: "user-owner",
  role: "owner",
};

let db: Database.Database;

function addArtifact(id: string, meta: Record<string, unknown>): void {
  db.prepare(
    `INSERT INTO artifacts (id, workspace_id, mode, kind, title, mime, body, meta, size_bytes, created_at, updated_at)
     VALUES (?, ?, 'data', 'analysis', ?, 'text/markdown', '', ?, 0, 0, 0)`,
  ).run(id, TENANT.workspaceId, id, JSON.stringify(meta));
}

function remainingIds(): string[] {
  return (db.prepare("SELECT id FROM artifacts ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
}

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`CREATE TABLE artifacts (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      mode text NOT NULL,
      kind text NOT NULL,
      title text NOT NULL,
      mime text NOT NULL,
      body text NOT NULL,
      meta text NOT NULL,
      size_bytes integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )`);
});

afterEach(() => {
  db.close();
});

describe("deleteArtifactsByOwner", () => {
  it("deletes only the artifacts of the owner it was given", () => {
    addArtifact("mine", { datasetId: "ds-1" });
    addArtifact("theirs", { datasetId: "ds-2" });

    expect(deleteArtifactsByOwner(TENANT, "datasetId", "ds-1", db)).toBe(1);
    expect(remainingIds()).toEqual(["theirs"]);
  });

  it("treats LIKE wildcards in the owner id as literal characters", () => {
    addArtifact("underscore", { datasetId: "ds_1" });
    addArtifact("neighbour", { datasetId: "dsX1" });
    addArtifact("percent", { datasetId: "ds%1" });
    addArtifact("long", { datasetId: "ds-anything-1" });

    // `ds_1` must not reach `dsX1`, and `ds%1` must not reach `ds-anything-1`.
    expect(deleteArtifactsByOwner(TENANT, "datasetId", "ds_1", db)).toBe(1);
    expect(deleteArtifactsByOwner(TENANT, "datasetId", "ds%1", db)).toBe(1);
    expect(remainingIds()).toEqual(["long", "neighbour"]);
  });

  it("deletes nothing for a bare wildcard, an injection payload, or an empty id", () => {
    addArtifact("one", { datasetId: "ds-1" });
    addArtifact("two", { matterId: "m-1" });

    for (const payload of ["%", "_", "' OR 1=1 --", '"); DROP TABLE artifacts; --', "", "\\%"]) {
      expect(deleteArtifactsByOwner(TENANT, "datasetId", payload, db), payload).toBe(0);
    }
    expect(remainingIds()).toEqual(["one", "two"]);
  });

  it("matches an owner id that carries a backslash, the escape character itself", () => {
    addArtifact("backslash", { datasetId: "ds\\1" });
    addArtifact("other", { datasetId: "ds1" });

    expect(deleteArtifactsByOwner(TENANT, "datasetId", "ds\\1", db)).toBe(1);
    expect(remainingIds()).toEqual(["other"]);
  });

  it("never crosses a workspace boundary", () => {
    addArtifact("elsewhere", { datasetId: "ds-1" });
    db.prepare("UPDATE artifacts SET workspace_id = ? WHERE id = ?").run("ws-other", "elsewhere");

    expect(deleteArtifactsByOwner(TENANT, "datasetId", "ds-1", db)).toBe(0);
    expect(remainingIds()).toEqual(["elsewhere"]);
  });
});
