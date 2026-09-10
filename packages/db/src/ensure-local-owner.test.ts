import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HOME_WORKSPACE_NAME,
  HOME_WORKSPACE_SLUG,
  LEGACY_HOME_WORKSPACE_NAME,
} from "@agentforge/core";
import { ensureSchema } from "./ensure-schema";
import * as schema from "./schema";
import { workspaces } from "./schema";
import { createLocalWorkspace, deleteLocalWorkspace, ensureLocalOwner } from "./ensure-local-owner";

describe("ensureLocalOwner default desk name", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    ensureSchema(sqlite);
    db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates the default desk as Default with slug home", async () => {
    await ensureLocalOwner(db);
    const [row] = await db.select().from(workspaces);
    expect(row?.slug).toBe(HOME_WORKSPACE_SLUG);
    expect(row?.name).toBe(HOME_WORKSPACE_NAME);
  });

  it("renames a leftover Home desk to Default on boot", async () => {
    await ensureLocalOwner(db);
    const [created] = await db.select().from(workspaces);
    await db
      .update(workspaces)
      .set({ name: LEGACY_HOME_WORKSPACE_NAME })
      .where(eq(workspaces.id, created.id));

    await ensureLocalOwner(db);
    const [row] = await db.select().from(workspaces).where(eq(workspaces.slug, HOME_WORKSPACE_SLUG));
    expect(row?.name).toBe(HOME_WORKSPACE_NAME);
  });

  it("does not rename a custom name on the home slug", async () => {
    await ensureLocalOwner(db);
    const [created] = await db.select().from(workspaces);
    await db.update(workspaces).set({ name: "Studio" }).where(eq(workspaces.id, created.id));

    await ensureLocalOwner(db);
    const [row] = await db.select().from(workspaces).where(eq(workspaces.slug, HOME_WORKSPACE_SLUG));
    expect(row?.name).toBe("Studio");
    expect(row?.slug).toBe(HOME_WORKSPACE_SLUG);
  });
});

describe("deleteLocalWorkspace", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    ensureSchema(sqlite);
    db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("refuses to delete the Default desk", async () => {
    const tenant = await ensureLocalOwner(db);
    const result = await deleteLocalWorkspace(db, tenant.organizationId, tenant.workspaceId);
    expect(result).toEqual({ ok: false, code: "protected" });
    const rows = await db.select().from(workspaces);
    expect(rows).toHaveLength(1);
  });

  it("deletes a non-default desk", async () => {
    const tenant = await ensureLocalOwner(db);
    const extra = await createLocalWorkspace(db, tenant.organizationId, "Scratch");
    sqlite.prepare("INSERT INTO knowledge_soul (workspace_id, name, role, voice, rules, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      extra.id,
      "Soul",
      "role",
      "voice",
      "rules",
      Date.now(),
    );
    const result = await deleteLocalWorkspace(db, tenant.organizationId, extra.id);
    expect(result).toEqual({ ok: true });
    const rows = await db.select().from(workspaces);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slug).toBe(HOME_WORKSPACE_SLUG);
    const soul = sqlite.prepare("SELECT COUNT(*) AS n FROM knowledge_soul WHERE workspace_id = ?").get(extra.id) as {
      n: number;
    };
    expect(soul.n).toBe(0);
  });
});
