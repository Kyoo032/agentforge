/**
 * Phase 6 — the quota arithmetic.
 *
 * Three things this has to get right: a desk is never limited, a malformed configuration value
 * falls back to the DEFAULT rather than to "no limit", and the admission test is on the RESULTING
 * total so a single large object cannot step over the ceiling.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_STORAGE_BYTES,
  formatBytes,
  STORAGE_BLOCK,
  storageAdmission,
  storageReport,
  tenantStorageLimitBytes,
} from "./quota";

const server = { AGENTFORGE_SERVER: "1" } as const;

describe("tenantStorageLimitBytes", () => {
  it("never limits a desk, whatever the variable says", () => {
    // The desktop's disk is the owner's own disk. A hosted default must not become a regression
    // for somebody who is not part of multi-tenancy at all.
    expect(tenantStorageLimitBytes({})).toBeNull();
    expect(tenantStorageLimitBytes({ AGENTFORGE_TENANT_STORAGE_BYTES: "1000" })).toBeNull();
    expect(tenantStorageLimitBytes({ AGENTFORGE_SERVER: "0", AGENTFORGE_TENANT_STORAGE_BYTES: "1000" })).toBeNull();
  });

  it("defaults in server mode when the variable is unset or empty", () => {
    expect(tenantStorageLimitBytes(server)).toBe(DEFAULT_TENANT_STORAGE_BYTES);
    expect(tenantStorageLimitBytes({ ...server, AGENTFORGE_TENANT_STORAGE_BYTES: "   " })).toBe(
      DEFAULT_TENANT_STORAGE_BYTES,
    );
  });

  it("reads an integer number of bytes", () => {
    expect(tenantStorageLimitBytes({ ...server, AGENTFORGE_TENANT_STORAGE_BYTES: "1048576" })).toBe(1048576);
  });

  it("turns the ceiling off only on an explicit spelling", () => {
    for (const raw of ["0", "off", "none", "unlimited", "UNLIMITED", " Off "]) {
      expect(tenantStorageLimitBytes({ ...server, AGENTFORGE_TENANT_STORAGE_BYTES: raw })).toBeNull();
    }
  });

  it("falls back to the default on junk, never to no-limit", () => {
    // A typo in a deployment variable must not be the thing that removes the only bound between
    // one tenant and the whole disk. Each of these is a plausible typo for "20 GB".
    for (const raw of ["20GB", "2e10", "20 GiB", "twenty", "-5", "1.5", "99999999999999999999"]) {
      expect(tenantStorageLimitBytes({ ...server, AGENTFORGE_TENANT_STORAGE_BYTES: raw })).toBe(
        DEFAULT_TENANT_STORAGE_BYTES,
      );
    }
  });
});

describe("storageReport", () => {
  it("reports nothing but bytes when there is no ceiling", () => {
    const report = storageReport({ usedBytes: 4096, objectCount: 3 }, null);
    expect(report).toEqual({
      usedBytes: 4096,
      objectCount: 3,
      limitBytes: null,
      percent: null,
      remainingBytes: null,
      warning: null,
      blocked: false,
    });
  });

  it("gives a percentage to one decimal and the bytes that are left", () => {
    const report = storageReport({ usedBytes: 250, objectCount: 1 }, 1000);
    expect(report.percent).toBe(25);
    expect(report.remainingBytes).toBe(750);
    expect(report.warning).toBeNull();
    expect(report.blocked).toBe(false);
  });

  it("warns at 80% and blocks at 100%", () => {
    expect(storageReport({ usedBytes: 799, objectCount: 1 }, 1000).warning).toBeNull();
    expect(storageReport({ usedBytes: 800, objectCount: 1 }, 1000).warning).toBe("storage_low");
    expect(storageReport({ usedBytes: 800, objectCount: 1 }, 1000).blocked).toBe(false);
    expect(storageReport({ usedBytes: 1000, objectCount: 1 }, 1000).blocked).toBe(true);
  });

  it("never reports negative headroom after a limit is lowered under a tenant", () => {
    // An operator who lowers the ceiling below what somebody already holds gets a tenant over
    // 100%, which is true, and zero bytes remaining, which is also true. Not a negative number.
    const report = storageReport({ usedBytes: 3000, objectCount: 9 }, 1000);
    expect(report.percent).toBe(300);
    expect(report.remainingBytes).toBe(0);
    expect(report.blocked).toBe(true);
  });

  it("clamps a nonsense counter rather than propagating it", () => {
    const report = storageReport({ usedBytes: -50, objectCount: -2 }, 1000);
    expect(report.usedBytes).toBe(0);
    expect(report.objectCount).toBe(0);
  });
});

describe("storageAdmission", () => {
  it("admits everything when there is no ceiling", () => {
    expect(storageAdmission({ usedBytes: 10 ** 12, incomingBytes: 10 ** 12, limitBytes: null })).toEqual({ ok: true });
  });

  it("tests the resulting total, not the current one", () => {
    // The single-large-object case: still under the line today, over it the moment this lands.
    expect(storageAdmission({ usedBytes: 900, incomingBytes: 50, limitBytes: 1000 })).toEqual({ ok: true });
    expect(storageAdmission({ usedBytes: 900, incomingBytes: 101, limitBytes: 1000 })).toEqual({
      ok: false,
      reason: STORAGE_BLOCK,
    });
  });

  it("admits a write that lands exactly on the ceiling", () => {
    expect(storageAdmission({ usedBytes: 900, incomingBytes: 100, limitBytes: 1000 })).toEqual({ ok: true });
  });

  it("never refuses a write that stores nothing", () => {
    // A delete, a probe or a zero-byte marker on a tenant already over its ceiling: a refusal here
    // would leave somebody who is full unable to do the one thing that makes room.
    expect(storageAdmission({ usedBytes: 5000, incomingBytes: 0, limitBytes: 1000 })).toEqual({ ok: true });
  });

  it("refuses with a code that is not the gateway's", () => {
    // Non-negotiable, for the same reason Phase 5 lane B's `plan_*` codes are not `gateway_blocked`:
    // that code sends the renderer to the paste-your-key screen, which is a dead end here.
    const verdict = storageAdmission({ usedBytes: 1000, incomingBytes: 1, limitBytes: 1000 });
    expect(verdict).toEqual({ ok: false, reason: "storage_quota_exceeded" });
    expect(STORAGE_BLOCK).not.toBe("gateway_blocked");
  });
});

describe("formatBytes", () => {
  it("is for messages, not arithmetic", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(20 * 1024 * 1024 * 1024)).toBe("20.0 GB");
  });
});
