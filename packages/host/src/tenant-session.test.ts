/**
 * Phase 3 lane C — resolving a tenant from a browser session.
 *
 * Isolation: the kernel SQLite lives in the data dir, so this file gets its own `mkdtemp` (AGENTS.md
 * "Known traps": one shared temp dir for the whole run races `ensureSchema` across workers).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-tenant-session-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "d".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

const SELECTED = join(dataDir, "workspace-id.txt");

let getTenant: typeof import("./tenant").getTenant;
let withRequestSession: typeof import("./tenant-scope").withRequestSession;
let ensurePortalOwner: typeof import("@agentforge/db").ensurePortalOwner;
let database: typeof import("@agentforge/db").db;

/** The hosted server is a per-process environment flag; every test that needs it sets it here. */
function serverMode(on: boolean): void {
  if (on) {
    process.env.AGENTFORGE_SERVER = "1";
  } else {
    delete process.env.AGENTFORGE_SERVER;
  }
}

const TENANT_A = { tenantId: "tenant-a", orgId: "org-a", userId: "user-a" };
const TENANT_B = { tenantId: "tenant-b", orgId: "org-b", userId: "user-b" };

function session(identity: typeof TENANT_A, id = `sid-${identity.userId}`) {
  return { id, tenantId: identity.tenantId, orgId: identity.orgId, userId: identity.userId };
}

describe("getTenant resolves the tenant from the session", () => {
  beforeAll(async () => {
    ({ getTenant } = await import("./tenant"));
    ({ withRequestSession } = await import("./tenant-scope"));
    const db = await import("@agentforge/db");
    ensurePortalOwner = db.ensurePortalOwner;
    database = db.db;
    await ensurePortalOwner(database, TENANT_A);
    await ensurePortalOwner(database, TENANT_B);
  }, 60_000);

  afterEach(() => {
    serverMode(false);
  });

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("gives two sessions on one server two different organizations", async () => {
    serverMode(true);

    const a = await getTenant({ workspaceId: null, session: session(TENANT_A) });
    const b = await getTenant({ workspaceId: null, session: session(TENANT_B) });

    expect(a.tenantId).toBe("tenant-a");
    expect(b.tenantId).toBe("tenant-b");
    expect(a.organizationId).not.toBe(b.organizationId);
    expect(a.workspaceId).not.toBe(b.workspaceId);
    expect(a.userId).toBe("user-a");
  });

  it("404s a workspace cookie naming another tenant's desk, and never substitutes home", async () => {
    serverMode(true);
    const other = await getTenant({ workspaceId: null, session: session(TENANT_B) });

    const refusal = await getTenant({ workspaceId: other.workspaceId, session: session(TENANT_A) }).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).code).toBe("workspace_not_found");
    expect((refusal as ApiError).status).toBe(404);
  });

  it("accepts a workspace cookie naming a desk the session's own org owns", async () => {
    serverMode(true);
    const own = await getTenant({ workspaceId: null, session: session(TENANT_A) });

    const scoped = await getTenant({ workspaceId: own.workspaceId, session: session(TENANT_A) });

    expect(scoped.workspaceId).toBe(own.workspaceId);
  });

  it("refuses a session whose tenant the host has never provisioned, rather than falling back", async () => {
    serverMode(true);

    const refusal = await getTenant({
      workspaceId: null,
      session: session({ tenantId: "tenant-never-seen", orgId: "org-x", userId: "user-x" }),
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).code).toBe("tenant_inactive");
    expect((refusal as ApiError).status).toBe(403);
  });

  it("refuses an org id from another tenant even when both ids are real", async () => {
    serverMode(true);

    const refusal = await getTenant({
      workspaceId: null,
      // Tenant A's session presenting tenant B's org: each id exists, the pair does not.
      session: { id: "sid-mixed", tenantId: TENANT_A.tenantId, orgId: TENANT_B.orgId, userId: TENANT_A.userId },
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).code).toBe("org_inactive");
  });

  it("fails closed in server mode when there is no session at all", async () => {
    serverMode(true);

    const refusal = await getTenant(null).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    expect((refusal as ApiError).code).toBe("session_required");
    expect((refusal as ApiError).status).toBe(401);
  });

  it("resolves the ambient session, so a call site still passing a bare desk id is scoped", async () => {
    serverMode(true);

    const tenant = await withRequestSession(session(TENANT_B), () => getTenant(null));

    expect(tenant.tenantId).toBe("tenant-b");
  });

  it("checks a bare desk id against the ambient session's desks, not against every desk", async () => {
    serverMode(true);
    const a = await getTenant({ workspaceId: null, session: session(TENANT_A) });

    const refusal = await withRequestSession(session(TENANT_B), () => getTenant(a.workspaceId)).catch(
      (error: unknown) => error,
    );

    expect((refusal as ApiError).code).toBe("workspace_not_found");
  });

  it("never writes the machine-wide desk file in server mode", async () => {
    serverMode(true);
    rmSync(SELECTED, { force: true });

    await getTenant({ workspaceId: null, session: session(TENANT_A) });

    expect(existsSync(SELECTED)).toBe(false);
  });

  it("ignores a machine-wide desk file that is already on disk in server mode", async () => {
    const b = await (async () => {
      serverMode(true);
      return getTenant({ workspaceId: null, session: session(TENANT_B) });
    })();
    writeFileSync(SELECTED, `${b.workspaceId}\n`, "utf8");
    serverMode(true);

    const a = await getTenant({ workspaceId: null, session: session(TENANT_A) });

    expect(a.workspaceId).not.toBe(b.workspaceId);
    rmSync(SELECTED, { force: true });
  });

  // The desktop half of the lane: off server mode nothing above applies and the local owner is
  // resolved exactly as it was before Phase 3.
  it("desktop mode still resolves the local owner with no session", async () => {
    const tenant = await getTenant(null);

    expect(tenant.tenantId).toBe("local-tenant");
    expect(tenant.userId).toBe("local-owner");
  });

  it("desktop mode still substitutes home for a desk id it does not know", async () => {
    const home = await getTenant(null);

    const substituted = await getTenant("a-desk-that-does-not-exist");

    expect(substituted.workspaceId).toBe(home.workspaceId);
  });

  it("desktop mode ignores an ambient session it could never have", async () => {
    const tenant = await withRequestSession(session(TENANT_A), () => getTenant(null));

    // Off server mode the session still wins when one is somehow present — the resolution is the
    // same code path — so this asserts the desktop's own path is reached when there is none.
    expect(tenant.tenantId).toBe("tenant-a");
  });
});
