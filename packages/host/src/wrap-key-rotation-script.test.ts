/**
 * Phase 4 — the rotation drill as an operator actually runs it.
 *
 * `wrap-key-rotation.test.ts` drives the rotation function, and every case in it hands over a
 * backend. That is how the drill shipped broken: run the way its own header documents — the hosted
 * store, `AGENTFORGE_SERVER=1` — `scripts/rotate-wrap-key.ts` died with
 * `tenant_state_backend_missing` before it read a byte, because only `router.ts` had ever installed
 * a database connection and the store fails closed rather than quietly reading a desk's files.
 *
 * A unit test could not see that: the bug was in the script's imports, not in the function. So this
 * runs the real file, in a real process, against a real database, and asserts the bytes that come
 * out the other side. It is the slowest test in the package, and worth it once.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptJson, encryptJson, wrappingKeyFromSecret } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";

const REPO = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO, "scripts", "rotate-wrap-key.ts");
/**
 * tsx's own JS entry, run by this Node — the same tsx the repo root installs. Not
 * `node_modules/.bin/tsx`: that is an extensionless POSIX shell shim Windows cannot execute, so every
 * run came back with no status and no output, and the "prints neither key" case passed on two empty
 * strings.
 */
const TSX_CLI = createRequire(path.join(REPO, "package.json")).resolve("tsx/cli");

const OLD_KEY = "11aa22bb33cc44dd55ee66ff7788990011aa22bb33cc44dd55ee66ff77889900";
const NEW_KEY = "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f";
const TENANT = "tenant-alpha";
const PAYLOAD = { version: 2, workspaces: { "desk-a": { openaiApiKey: "sk-alpha-key-0000" } } };

const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-rotate-script-"));

function sealed(secret: string): string {
  return `${JSON.stringify(encryptJson(PAYLOAD, wrappingKeyFromSecret(secret)))}\n`;
}

/** The database the script will open for itself, seeded the way a hosted deployment's looks. */
function seed(): void {
  const sqlite = new Database(path.join(dataDir, "agentforge.sqlite"));
  try {
    ensureSchema(sqlite);
    sqlite
      .prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(TENANT, TENANT, TENANT, "active", Date.now());
    sqlite
      .prepare(
        `INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, 'settings', ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(TENANT, sealed(OLD_KEY), Date.now());
  } finally {
    sqlite.close();
  }
}

function storedValue(): string {
  const sqlite = new Database(path.join(dataDir, "agentforge.sqlite"), { readonly: true });
  try {
    return (
      sqlite.prepare("SELECT value FROM tenant_state WHERE tenant_id = ? AND key = 'settings'").get(TENANT) as {
        value: string;
      }
    ).value;
  } finally {
    sqlite.close();
  }
}

function run(args: string[]): { status: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [TSX_CLI, SCRIPT, ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENTFORGE_DATA_DIR: dataDir,
        AGENTFORGE_SERVER: "1",
        AGENTFORGE_SECRETS_KEY: OLD_KEY,
      },
    });
    return { status: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

beforeEach(() => {
  rmSync(path.join(dataDir, "agentforge.sqlite"), { force: true });
  seed();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * Every `run` starts a real Node process that compiles the script and opens a real database: about
 * 3 s each on a quiet Windows desk. The call is synchronous, so vitest's 5 s default failed a case
 * after the fact; the budgets below are 60 s per process a case starts.
 */
describe("scripts/rotate-wrap-key.ts against the hosted store", () => {
  it("rehearses the rotation without writing, and says so", () => {
    const before = storedValue();

    const result = run(["--from", OLD_KEY, "--to", NEW_KEY, "--dry-run"]);

    expect(result.out).not.toMatch(/tenant_state_backend_missing/);
    expect(result.status).toBe(0);
    expect(result.out).toContain("db store: would re-seal 1 tenant(s).");
    expect(storedValue()).toBe(before);
  }, 60_000);

  it("re-seals the tenant's row under the new key", () => {
    const result = run(["--from", OLD_KEY, "--to", NEW_KEY]);

    expect(result.status).toBe(0);
    expect(result.out).toContain("db store: re-sealed 1 tenant(s).");

    const after = JSON.parse(storedValue());
    expect(decryptJson<unknown>(after, wrappingKeyFromSecret(NEW_KEY))).toEqual(PAYLOAD);
    expect(() => decryptJson<unknown>(after, wrappingKeyFromSecret(OLD_KEY))).toThrow();
  }, 60_000);

  it("refuses a wrong current key and leaves the row exactly as it was", () => {
    const before = storedValue();

    const result = run(["--from", NEW_KEY, "--to", OLD_KEY]);

    expect(result.status).toBe(1);
    expect(result.out).toContain("Refused");
    expect(storedValue()).toBe(before);
  }, 60_000);

  it("prints neither key, whatever happens", () => {
    const rotated = run(["--from", OLD_KEY, "--to", NEW_KEY]);
    const refused = run(["--from", OLD_KEY, "--to", NEW_KEY]);

    // Both paths really ran — a rotation and then a refusal — so the checks below read real output.
    expect(rotated.out).toContain("db store: re-sealed 1 tenant(s).");
    expect(refused.status).toBe(1);
    expect(refused.out).toContain("Refused");
    for (const output of [rotated.out, refused.out]) {
      expect(output).not.toContain(OLD_KEY);
      expect(output).not.toContain(NEW_KEY);
    }
  }, 120_000);
});
