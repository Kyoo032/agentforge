import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Isolation: the kernel SQLite and workspace-id.txt both live in the data dir.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-tenant-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "c".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

const SELECTED = join(dataDir, "workspace-id.txt");

let getTenant: typeof import("./tenant").getTenant;

describe("getTenant records the selected desk", () => {
  beforeAll(async () => {
    ({ getTenant } = await import("./tenant"));
  }, 60_000);

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("writes workspace-id.txt on the first request of a fresh install", async () => {
    rmSync(SELECTED, { force: true });
    expect(existsSync(SELECTED)).toBe(false);

    const tenant = await getTenant();

    expect(existsSync(SELECTED)).toBe(true);
    expect(readFileSync(SELECTED, "utf8").trim()).toBe(tenant.workspaceId);
  });

  it("never overwrites a selection that is already on disk", async () => {
    writeFileSync(SELECTED, "desk-chosen-by-the-owner\n", "utf8");

    await getTenant();

    expect(readFileSync(SELECTED, "utf8").trim()).toBe("desk-chosen-by-the-owner");
  });

  // A request that names its own desk (the WORKSPACE_COOKIE one tab carries) speaks for that tab,
  // not for the install: promoting it would repoint every deskless read behind the owner's back.
  it("does not record a desk the caller asked for on this request alone", async () => {
    rmSync(SELECTED, { force: true });

    await getTenant("desk-from-one-tabs-cookie");

    expect(existsSync(SELECTED)).toBe(false);
  });
});
