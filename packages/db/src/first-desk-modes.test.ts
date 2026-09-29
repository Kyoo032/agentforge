/**
 * The first desk of a fresh Personal install is Research, Images, Videos and Presentation plus Chat
 * (owner decision, Rizky, 2026-09-29), and nothing else. This file holds the structural half of that
 * hard rule; `packages/host/src/first-run-modes.test.ts` holds the half that goes through the real
 * first-run path on a real data dir, including Start over.
 *
 * The expected list is spelled out here on purpose. A test that read `FIRST_RUN_MODES` back would
 * pass whatever the constant said.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_MODES } from "@agentforge/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalWorkspace, ensureLocalOwner } from "./ensure-local-owner";
import { ensureSchema } from "./ensure-schema";
import { ensurePortalOwner } from "./portal-owner";
import * as schema from "./schema";
import { workspaces } from "./schema";

const PERSONAL_FIRST_DESK = ["chat", "research", "images", "videos", "presentations"];
const EVERY_MODE = PRODUCT_MODES.map((mode) => mode.id);

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AGENTFORGE_SERVER", "");
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  ensureSchema(sqlite);
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
  vi.unstubAllEnvs();
});

async function homeDesk() {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.slug, "home"));
  return row;
}

describe("ensureLocalOwner: the first desk on a fresh Personal install", () => {
  it("is created with exactly Chat, Research, Images, Videos and Presentation", async () => {
    await ensureLocalOwner(db);

    const row = await homeDesk();
    expect(row?.productModes).toEqual(PERSONAL_FIRST_DESK);
  });

  it("carries no mode outside that list, whatever the catalog grows to", async () => {
    await ensureLocalOwner(db);

    const stored = (await homeDesk())?.productModes ?? [];
    const extra = stored.filter((id) => !PERSONAL_FIRST_DESK.includes(id));
    expect(extra).toEqual([]);
    const missing = PERSONAL_FIRST_DESK.filter((id) => !stored.includes(id));
    expect(missing).toEqual([]);
  });

  it("holds after a second boot: the row is found and left alone", async () => {
    await ensureLocalOwner(db);
    await ensureLocalOwner(db);

    expect(await db.select().from(workspaces)).toHaveLength(1);
    expect((await homeDesk())?.productModes).toEqual(PERSONAL_FIRST_DESK);
  });

  it("never rewrites an existing desk: a desk with every mode keeps every mode", async () => {
    await ensureLocalOwner(db);
    await db.update(workspaces).set({ productModes: [...EVERY_MODE] }).where(eq(workspaces.slug, "home"));

    await ensureLocalOwner(db);

    expect((await homeDesk())?.productModes).toEqual(EVERY_MODE);
  });

  it("never rewrites an existing desk: a pre-column desk (NULL modes) stays NULL and reads as every mode", async () => {
    await ensureLocalOwner(db);
    sqlite.prepare("UPDATE workspaces SET product_modes = NULL WHERE slug = 'home'").run();

    await ensureLocalOwner(db);

    const [row] = sqlite.prepare("SELECT product_modes AS modes FROM workspaces WHERE slug = 'home'").all() as Array<{
      modes: string | null;
    }>;
    expect(row?.modes).toBeNull();
  });

  it("does not shrink a desk the owner has since edited", async () => {
    await ensureLocalOwner(db);
    const edited = ["chat", "documents", "research", "finance", "images", "videos", "presentations"];
    await db.update(workspaces).set({ productModes: edited }).where(eq(workspaces.slug, "home"));

    await ensureLocalOwner(db);

    expect((await homeDesk())?.productModes).toEqual(edited);
  });

  it("does not touch a desk created later: that is a choice the owner made", async () => {
    const tenant = await ensureLocalOwner(db);
    const made = await createLocalWorkspace(db, tenant.organizationId, "Studio", undefined, [...EVERY_MODE]);

    expect(made.productModes).toEqual(EVERY_MODE);
    expect((await homeDesk())?.productModes).toEqual(PERSONAL_FIRST_DESK);
  });
});

describe("the hosted Enterprise app keeps every mode on a first desk", () => {
  it("ensurePortalOwner creates a tenant's Default desk with every mode", async () => {
    const tenant = await ensurePortalOwner(db, { tenantId: "tnt_ent", orgId: "org_ent", userId: "usr_ent" });

    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, tenant.workspaceId));
    expect(row?.productModes).toEqual(EVERY_MODE);
  });

  it("a hosted process that reaches ensureLocalOwner still gets every mode, not the Personal list", async () => {
    vi.stubEnv("AGENTFORGE_SERVER", "1");

    await ensureLocalOwner(db);

    expect((await homeDesk())?.productModes).toEqual(EVERY_MODE);
  });
});

/**
 * A structure test, not a behaviour one: it fails when somebody adds a second place that writes a
 * desk row, because a second place is where a first-run default drifts. The two writers that exist
 * are named, and each must take its modes from the one constant it is supposed to.
 */
describe("every desk writer takes its first-desk modes from the named constants", () => {
  const packagesRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const appsRoot = join(packagesRoot, "..", "apps");

  function sourceFiles(root: string): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
          continue;
        }
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx|mjs|cjs)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && name !== "host.cjs") {
          found.push(path);
        }
      }
    };
    walk(root);
    return found;
  }

  // `insert(workspaces)` and `insert(schema.workspaces)`, and a hand-written INSERT.
  const insertSite = /\.insert\(\s*(?:schema\.)?workspaces\s*\)|INSERT\s+(OR\s+\w+\s+)?INTO\s+workspaces\b/i;

  it("only ensure-local-owner.ts and portal-owner.ts insert into workspaces", () => {
    const writers = [...sourceFiles(packagesRoot), ...sourceFiles(appsRoot)]
      .filter((file) => insertSite.test(readFileSync(file, "utf8")))
      .map((file) => relative(packagesRoot, file).replaceAll("\\", "/"))
      .sort();
    expect(writers).toEqual(["db/src/ensure-local-owner.ts", "db/src/portal-owner.ts"]);
  });

  it("the Personal first desk reads FIRST_RUN_MODES through firstDeskModes, never a literal or WORK_PRODUCT_MODES", () => {
    const source = readFileSync(join(packagesRoot, "db", "src", "ensure-local-owner.ts"), "utf8");
    const firstDesk = source.slice(source.indexOf("ownedWorkspaces.length === 0"), source.indexOf("const homeRow"));
    expect(firstDesk).toContain("productModes: firstDeskModes(isServerMode())");
    expect(firstDesk).not.toContain("WORK_PRODUCT_MODES");
  });

  it("the hosted first desk reads HOSTED_FIRST_DESK_MODES, so Enterprise cannot inherit the Personal list", () => {
    const source = readFileSync(join(packagesRoot, "db", "src", "portal-owner.ts"), "utf8");
    expect(source).toContain("productModes: [...HOSTED_FIRST_DESK_MODES]");
    expect(source).not.toContain("FIRST_RUN_MODES");
  });
});
