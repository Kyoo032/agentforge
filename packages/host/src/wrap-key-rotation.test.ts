/**
 * Phase 4 — the wrap-key rotation drill.
 *
 * The plan's test for this phase is "a wrap-key rotation re-encrypts without data loss"
 * (`docs/internal/web-migration-plan.md`, Phase 4). Data loss here has a specific shape: a rotation
 * that gets partway through leaves some tenants sealed under the old key and some under the new
 * one, which is a state no single key can read and no second run can repair. So the cases that
 * matter most are the refusals — the ones that prove nothing was written.
 *
 * Both backends are driven, because the drill has to work on a desk (files) and on the hosted
 * server (rows), and the whole reason it can is that the stored bytes are the same in both.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptJson, encryptJson, LOCAL_TENANT_ID, wrappingKeyFromSecret } from "@agentforge/core";
import { ensureSchema } from "@agentforge/db/ensure-schema";

const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-rotate-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SERVER;

const { rotateWrapKey, WrapKeyRotationError } = await import("./wrap-key-rotation");
const stateStore = await import("./tenant-state-store");
const { TENANTS_DIR } = await import("./tenant-paths");

const OLD_KEY = "11aa22bb33cc44dd55ee66ff7788990011aa22bb33cc44dd55ee66ff77889900";
const NEW_KEY = "f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f";

const A = "tenant-alpha";
const B = "tenant-beta";

function payloadFor(deskId: string, apiKey: string): unknown {
  return { version: 2, workspaces: { [deskId]: { openaiApiKey: apiKey } } };
}

function sealed(payload: unknown, secret: string): string {
  return `${JSON.stringify(encryptJson(payload, wrappingKeyFromSecret(secret)))}\n`;
}

function openWith(raw: string, secret: string): unknown {
  return decryptJson<unknown>(JSON.parse(raw), wrappingKeyFromSecret(secret));
}

/* -------------------------------------------------------------------------------- file backend */

function tenantFile(tenantId: string): string {
  return tenantId === LOCAL_TENANT_ID
    ? path.join(dataDir, "settings.enc")
    : path.join(dataDir, TENANTS_DIR, tenantId, "settings.enc");
}

function writeFileState(tenantId: string, value: string): void {
  const file = tenantFile(tenantId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, value, "utf8");
}

function clearDataDir(): void {
  for (const entry of readdirSync(dataDir)) {
    rmSync(path.join(dataDir, entry), { recursive: true, force: true });
  }
}

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("rotating the file store (a desk, or a webdev instance)", () => {
  beforeEach(() => {
    clearDataDir();
  });

  it("re-seals every tenant and loses nothing", () => {
    writeFileState(LOCAL_TENANT_ID, sealed(payloadFor("home", "sk-local-key-0000"), OLD_KEY));
    writeFileState(A, sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY));
    writeFileState(B, sealed(payloadFor("desk-b", "sk-beta-key-00000"), OLD_KEY));

    const result = rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.fileTenantStateBackend });

    expect(result.backend).toBe("file");
    expect(result.rotated.sort()).toEqual([A, B, LOCAL_TENANT_ID].sort());
    expect(openWith(readFileSync(tenantFile(A), "utf8"), NEW_KEY)).toEqual(
      payloadFor("desk-a", "sk-alpha-key-0000"),
    );
    expect(openWith(readFileSync(tenantFile(LOCAL_TENANT_ID), "utf8"), NEW_KEY)).toEqual(
      payloadFor("home", "sk-local-key-0000"),
    );
    // And the old key no longer opens any of them, which is the point of rotating.
    expect(() => openWith(readFileSync(tenantFile(B), "utf8"), OLD_KEY)).toThrow();
  });

  it("finds the local tenant at the install root and every other under tenants/", () => {
    writeFileState(LOCAL_TENANT_ID, sealed(payloadFor("home", "sk-local-key-0000"), OLD_KEY));
    writeFileState(A, sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY));

    // Lane D's one rule, seen from the rotation's side: the local tenant's root IS the install root,
    // so a walk that only looked under `tenants/` would silently skip the desktop owner's own key.
    expect(stateStore.fileTenantStateBackend.tenantsWith("settings").sort()).toEqual([A, LOCAL_TENANT_ID].sort());
  });

  it("writes NOTHING when one tenant will not open with the current key", () => {
    const goodA = sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY);
    const strangerB = sealed(payloadFor("desk-b", "sk-beta-key-00000"), NEW_KEY);
    writeFileState(A, goodA);
    writeFileState(B, strangerB);

    expect(() => rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.fileTenantStateBackend })).toThrow(
      WrapKeyRotationError,
    );

    // The tenant that would have rotated first is untouched: this is the two-phase commit working.
    expect(readFileSync(tenantFile(A), "utf8")).toBe(goodA);
    expect(readFileSync(tenantFile(B), "utf8")).toBe(strangerB);
  });

  it("names the tenant that would not open, and nothing about the key", () => {
    writeFileState(A, sealed(payloadFor("desk-a", "sk-alpha-key-0000"), NEW_KEY));
    try {
      rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.fileTenantStateBackend });
      throw new Error("expected the rotation to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WrapKeyRotationError);
      expect((error as InstanceType<typeof WrapKeyRotationError>).tenantId).toBe(A);
      expect((error as Error).message).not.toContain(OLD_KEY);
      expect((error as Error).message).not.toContain(NEW_KEY);
    }
  });

  it("rehearses with --dry-run and writes nothing", () => {
    const before = sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY);
    writeFileState(A, before);

    const result = rotateWrapKey({
      from: OLD_KEY,
      to: NEW_KEY,
      dryRun: true,
      backend: stateStore.fileTenantStateBackend,
    });

    expect(result).toMatchObject({ dryRun: true, rotated: [A] });
    expect(readFileSync(tenantFile(A), "utf8")).toBe(before);
  });

  it("is a no-op that reports nothing when there is nothing stored", () => {
    expect(rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.fileTenantStateBackend })).toMatchObject({
      rotated: [],
      skipped: [],
    });
  });

  it("refuses a payload that is not a sealed envelope, before writing anything", () => {
    writeFileState(A, sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY));
    writeFileState(B, "{}\n");
    expect(() => rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.fileTenantStateBackend })).toThrow(
      /not a sealed envelope/,
    );
    expect(openWith(readFileSync(tenantFile(A), "utf8"), OLD_KEY)).toBeTruthy();
  });

  it("refuses a weak or malformed key on either side", () => {
    writeFileState(A, sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY));
    const backend = stateStore.fileTenantStateBackend;
    // Too short to be a wrap key at all.
    expect(() => rotateWrapKey({ from: "abcd", to: NEW_KEY, backend })).toThrow(/current wrap key/);
    // Long enough, but typed rather than generated. Refused as the NEW key, allowed as the current
    // one: rotating AWAY from a weak key is exactly what someone would want this for.
    expect(() => rotateWrapKey({ from: OLD_KEY, to: "a".repeat(64), backend })).toThrow(/not random/);
    expect(() => rotateWrapKey({ from: "a".repeat(64), to: NEW_KEY, backend })).toThrow(
      /do not open with the current wrap key/,
    );
    // And rotating onto the same key is a mistake, not a no-op.
    expect(() => rotateWrapKey({ from: OLD_KEY, to: OLD_KEY, backend })).toThrow(/same as the current one/);
  });
});

/* ---------------------------------------------------------------------------------- row backend */

describe("rotating the hosted row store", () => {
  let sqlite: Database.Database;

  function putRow(tenantId: string, value: string): void {
    sqlite
      .prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(tenantId, tenantId, tenantId, "active", Date.now());
    sqlite
      .prepare(
        `INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, 'settings', ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(tenantId, value, Date.now());
  }

  function rowValue(tenantId: string): string {
    return (
      sqlite.prepare("SELECT value FROM tenant_state WHERE tenant_id = ? AND key = 'settings'").get(tenantId) as {
        value: string;
      }
    ).value;
  }

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    stateStore.registerTenantStateSql(sqlite as unknown as Parameters<typeof stateStore.registerTenantStateSql>[0]);
  });

  it("re-seals every tenant's row", () => {
    putRow(A, sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY));
    putRow(B, sealed(payloadFor("desk-b", "sk-beta-key-00000"), OLD_KEY));

    const result = rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.dbTenantStateBackend });

    expect(result).toMatchObject({ backend: "db", rotated: [A, B] });
    expect(openWith(rowValue(A), NEW_KEY)).toEqual(payloadFor("desk-a", "sk-alpha-key-0000"));
    expect(openWith(rowValue(B), NEW_KEY)).toEqual(payloadFor("desk-b", "sk-beta-key-00000"));
    expect(() => openWith(rowValue(A), OLD_KEY)).toThrow();
  });

  it("writes NOTHING when one row will not open with the current key", () => {
    const goodA = sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY);
    putRow(A, goodA);
    putRow(B, sealed(payloadFor("desk-b", "sk-beta-key-00000"), NEW_KEY));

    expect(() => rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.dbTenantStateBackend })).toThrow(
      WrapKeyRotationError,
    );
    expect(rowValue(A)).toBe(goodA);
  });

  it("leaves the gate verdict alone, because no wrap key opens it", () => {
    putRow(A, sealed(payloadFor("desk-a", "sk-alpha-key-0000"), OLD_KEY));
    sqlite
      .prepare("INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, 'gateway_gate', ?, ?)")
      .run(A, '{"version":1,"status":"ok"}\n', Date.now());

    rotateWrapKey({ from: OLD_KEY, to: NEW_KEY, backend: stateStore.dbTenantStateBackend });

    const verdict = sqlite
      .prepare("SELECT value FROM tenant_state WHERE tenant_id = ? AND key = 'gateway_gate'")
      .get(A) as { value: string };
    expect(JSON.parse(verdict.value)).toMatchObject({ version: 1, status: "ok" });
  });
});
