/**
 * Edit metrics are read back only by the tenant and organization they belong to.
 *
 * `GET /api/v1/edit/metrics` used to fold one machine-wide `<dataDir>/edit/metrics.jsonl` for every
 * caller, and each line carries project, run, card and job ids — so on the hosted server any signed-in
 * tenant read every other tenant's Edit activity. Now each line is filed under the project's own
 * tenant (in that tenant's data directory, which the per-tenant purge removes) and stamped with the
 * tenant and organization; a read returns only lines stamped with the caller's pair. The organization
 * matters as much as the tenant: a tenant is a whitelabel partner, and its organizations are separate
 * customers. A line written before the stamp names nobody, so the hosted server never serves one.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-edit-metrics-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "5d1e8a3fb2c0947e6a18d5f3c29b70e4a6d3f1c8b5e2097a4c6f8d1b3e5a7092";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import { LOCAL_TENANT_ID, type TenantContext } from "@agentforge/core";
import { db, ensurePortalOwner } from "@agentforge/db";
import { dispatch } from "../router";
import { createSession, SESSION_COOKIE_SECURE } from "../auth/session";
import { createMemorySessionStore } from "../auth/session-store";
import type { HostJsonResult } from "../types";
import { getTenant } from "../tenant";
import { appendEditMetric, foldEditMetrics } from "./metrics";
import { createEditProject } from "./projects";

const T0 = Date.UTC(2026, 8, 23, 9, 0, 0);

const ALPHA = { tenantId: "metrics-tenant-a", orgId: "metrics-org-a", userId: "metrics-user-a" };
/** A second customer organization inside the same whitelabel tenant as ALPHA. */
const ALPHA_SIBLING = { tenantId: "metrics-tenant-a", orgId: "metrics-org-a2", userId: "metrics-user-a2" };
const BETA = { tenantId: "metrics-tenant-b", orgId: "metrics-org-b", userId: "metrics-user-b" };

const MARK_A = "ALPHA-METRIC-MARKER-7c1e";
const MARK_A2 = "ALPHA-SIBLING-METRIC-MARKER-4d9b";
const MARK_B = "BETA-METRIC-MARKER-2f6a";
const MARK_LEGACY = "LEGACY-UNSCOPED-METRIC-MARKER-8a3c";

let tenantA: TenantContext;
let tenantA2: TenantContext;
let tenantB: TenantContext;
let projectA = "";
let projectA2 = "";
let projectB = "";

const store = createMemorySessionStore();
const cookies: Record<string, string> = {};

function metricsFileOf(tenantId: string): string {
  return tenantId === LOCAL_TENANT_ID
    ? join(dataDir, "edit", "metrics.jsonl")
    : join(dataDir, "tenants", tenantId, "edit", "metrics.jsonl");
}

function writeRawLine(file: string, line: Record<string, unknown>): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(line)}\n`, "utf8");
}

async function readMetricsAs(who: keyof typeof cookies): Promise<string> {
  const result = (await dispatch(
    { method: "GET", path: "/api/v1/edit/metrics", query: { range: "month" }, params: {}, headers: { cookie: cookies[who] } },
    { serverMode: true, sessionStore: store, now: () => T0 },
  )) as HostJsonResult;
  expect(result.status).toBe(200);
  return JSON.stringify(result.body);
}

beforeAll(async () => {
  tenantA = await ensurePortalOwner(db, ALPHA);
  tenantA2 = await ensurePortalOwner(db, ALPHA_SIBLING);
  tenantB = await ensurePortalOwner(db, BETA);
  for (const [key, identity] of [
    ["a", ALPHA],
    ["a2", ALPHA_SIBLING],
    ["b", BETA],
  ] as const) {
    const session = createSession({ ...identity, now: T0 });
    await store.create(session);
    // The hosted server (AGENTFORGE_SERVER=1 below) reads only the `__Host-` name.
    cookies[key] = `${SESSION_COOKIE_SECURE}=${session.id}`;
  }
  projectA = (await createEditProject(tenantA, { name: "metrics A", aspect: "16:9", fps: 30 })).id;
  projectA2 = (await createEditProject(tenantA2, { name: "metrics A2", aspect: "16:9", fps: 30 })).id;
  projectB = (await createEditProject(tenantB, { name: "metrics B", aspect: "16:9", fps: 30 })).id;

  await appendEditMetric({ projectId: projectA, runId: "run-a", event: "agent.turn", data: { marker: MARK_A } });
  await appendEditMetric({ projectId: projectA2, cardId: "card-a2", event: "card.decided", data: { marker: MARK_A2 } });
  await appendEditMetric({ projectId: projectB, jobId: "job-b", event: "job.cancelled", data: { marker: MARK_B } });
}, 60_000);

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
});

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort, as in test/global-setup.ts: on Windows an open handle can refuse the delete.
  }
});

describe("writing an Edit metric", () => {
  it("files the line under the project's own tenant, stamped with tenant and organization", () => {
    const aLines = readFileSync(metricsFileOf(ALPHA.tenantId), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const bLines = readFileSync(metricsFileOf(BETA.tenantId), "utf8").trim().split("\n").map((line) => JSON.parse(line));

    expect(aLines).toContainEqual(
      expect.objectContaining({ tenantId: ALPHA.tenantId, organizationId: ALPHA.orgId, projectId: projectA }),
    );
    expect(aLines).toContainEqual(
      expect.objectContaining({ tenantId: ALPHA.tenantId, organizationId: ALPHA_SIBLING.orgId, projectId: projectA2 }),
    );
    expect(bLines).toEqual([
      expect.objectContaining({ tenantId: BETA.tenantId, organizationId: BETA.orgId, projectId: projectB }),
    ]);
    // Nothing hosted lands in the machine-wide file any more.
    expect(existsSync(metricsFileOf(LOCAL_TENANT_ID))).toBe(false);
  });
});

describe("folding Edit metrics", () => {
  it("returns only the caller's own organization", () => {
    const a = JSON.stringify(foldEditMetrics(tenantA, "month"));
    const a2 = JSON.stringify(foldEditMetrics(tenantA2, "month"));
    const b = JSON.stringify(foldEditMetrics(tenantB, "month"));

    expect(a).toContain(MARK_A);
    expect(a).not.toContain(MARK_A2);
    expect(a).not.toContain(MARK_B);
    expect(a2).toContain(MARK_A2);
    expect(a2).not.toContain(MARK_A);
    expect(b).toContain(MARK_B);
    expect(b).not.toContain(MARK_A);
    expect(b).not.toContain(projectA);
  });

  it("serves an unstamped line to the desk's owner, and never on the hosted server", async () => {
    const local = await getTenant();
    writeRawLine(metricsFileOf(LOCAL_TENANT_ID), {
      at: new Date().toISOString(),
      projectId: "legacy-project",
      event: "agent.turn",
      data: { marker: MARK_LEGACY },
    });

    expect(JSON.stringify(foldEditMetrics(local, "month", { serverMode: false }))).toContain(MARK_LEGACY);
    expect(JSON.stringify(foldEditMetrics(local, "month", { serverMode: true }))).not.toContain(MARK_LEGACY);
  });

  it("never hands an unstamped line to a tenant other than the desk's owner", () => {
    writeRawLine(metricsFileOf(BETA.tenantId), {
      at: new Date().toISOString(),
      projectId: "legacy-project-b",
      event: "agent.turn",
      data: { marker: `${MARK_LEGACY}-B` },
    });

    expect(JSON.stringify(foldEditMetrics(tenantB, "month", { serverMode: false }))).not.toContain(`${MARK_LEGACY}-B`);
    expect(JSON.stringify(foldEditMetrics(tenantB, "month", { serverMode: true }))).not.toContain(`${MARK_LEGACY}-B`);
  });
});

describe("GET /api/v1/edit/metrics on the hosted server", () => {
  it("shows each session its own organization's activity and nobody else's", async () => {
    process.env.AGENTFORGE_SERVER = "1";
    const asA = await readMetricsAs("a");
    const asA2 = await readMetricsAs("a2");
    const asB = await readMetricsAs("b");

    expect(asA).toContain(MARK_A);
    expect(asA).not.toContain(MARK_A2);
    expect(asA).not.toContain(MARK_B);
    expect(asA2).toContain(MARK_A2);
    expect(asA2).not.toContain(MARK_A);
    expect(asB).toContain(MARK_B);
    expect(asB).not.toContain(MARK_A);
    expect(asB).not.toContain(projectA);
    expect(asB).not.toContain(projectA2);
  });

  it("serves none of the old machine-wide lines to a hosted session", async () => {
    // What a hosted box that ran the old code still has on disk: unstamped lines about everybody.
    writeRawLine(metricsFileOf(LOCAL_TENANT_ID), {
      at: new Date().toISOString(),
      projectId: projectA,
      event: "agent.turn",
      data: { marker: `${MARK_LEGACY}-hosted` },
    });
    process.env.AGENTFORGE_SERVER = "1";

    expect(await readMetricsAs("a")).not.toContain(`${MARK_LEGACY}-hosted`);
    expect(await readMetricsAs("b")).not.toContain(`${MARK_LEGACY}-hosted`);
  });
});
