import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, wrappingKeyFromSecret, type TenantContext } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";
import { ARTIFACT_BODY_MAX_BYTES, createArtifactStore, type ArtifactStore } from "./artifacts";

const KEY = wrappingKeyFromSecret("b".repeat(64));

const tenant: TenantContext = { organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };
const otherDesk: TenantContext = { ...tenant, workspaceId: "ws-2" };

describe("artifact store", () => {
  let db: Database.Database;
  let store: ArtifactStore;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    store = createArtifactStore(db, () => KEY);
  });

  afterEach(() => {
    db.close();
  });

  it("creates, lists, reads, and deletes within a workspace", () => {
    const created = store.create(tenant, {
      mode: "research",
      kind: "dossier",
      title: "  Lithium recycling  ",
      mime: "text/markdown",
      body: "# Lithium\n\nbody",
      meta: { question: "Is it profitable?", sourceCount: 3, extra: "kept" },
    });
    expect(created.title).toBe("Lithium recycling");
    expect(created.sizeBytes).toBe(Buffer.byteLength("# Lithium\n\nbody"));

    const listed = store.list(tenant, "research");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      kind: "dossier",
      meta: { question: "Is it profitable?", extra: "kept" },
    });
    expect("body" in (listed[0] as object)).toBe(false);

    expect(store.get(tenant, created.id)?.body).toBe("# Lithium\n\nbody");
    expect(store.list(tenant, "data")).toEqual([]);
    expect(store.remove(tenant, created.id)).toBe(true);
    expect(store.get(tenant, created.id)).toBeNull();
    expect(store.remove(tenant, created.id)).toBe(false);
  });

  it("seals the body at rest and keeps other desks out", () => {
    const created = store.create(tenant, {
      mode: "data",
      kind: "analysis",
      title: "Spend",
      mime: "text/markdown",
      body: "secret numbers 12000",
    });
    const raw = db.prepare("SELECT body FROM artifacts WHERE id = ?").get(created.id) as { body: string };
    expect(raw.body).not.toContain("secret numbers");
    expect(store.get(otherDesk, created.id)).toBeNull();
    expect(store.list(otherDesk)).toEqual([]);
    expect(store.remove(otherDesk, created.id)).toBe(false);
  });

  it("orders newest first and lists every mode when none is given", () => {
    const first = store.create(tenant, {
      mode: "finance",
      kind: "brief",
      title: "A",
      mime: "text/markdown",
      body: "a",
    });
    db.prepare("UPDATE artifacts SET created_at = created_at - 1000 WHERE id = ?").run(first.id);
    store.create(tenant, { mode: "research", kind: "dossier", title: "B", mime: "text/markdown", body: "b" });
    expect(store.list(tenant).map((item) => item.title)).toEqual(["B", "A"]);
  });

  it("rejects bad input", () => {
    const base = { mode: "research", kind: "dossier", title: "T", mime: "text/markdown", body: "x" } as const;
    expect(() => store.create(tenant, { ...base, mode: "campus" as never })).toThrow(ApiError);
    expect(() => store.create(tenant, { ...base, title: "   " })).toThrow(/title/);
    expect(() => store.create(tenant, { ...base, body: "" })).toThrow(/body/);
    expect(() => store.create(tenant, { ...base, body: "x".repeat(ARTIFACT_BODY_MAX_BYTES + 1) })).toThrow(/4 MB/);
  });
});
