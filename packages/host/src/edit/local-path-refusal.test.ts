/**
 * Phase 8 — a file path is a desktop idea, and the hosted server refuses it by name.
 *
 * The transport check has kept `sourcePath` off HTTP since it was written, and it is still the rule
 * for the desktop and webdev. What it does not do is SAY anything: a hosted tenant who sends a path
 * got `invalid_request`, the same answer a typo gets, and the refusal read as an accident of
 * plumbing rather than as policy. It is policy — reading a caller-named path off the server's own
 * filesystem is the whole of what a hosted deployment must never do — so in server mode it has its
 * own code, checked first, and a capability flag (`localPaths`) that tells the renderer why.
 *
 * Driven through `dispatch` with a real hosted session, because the refusal sits inside the route
 * and after the session gate: a test without a session would be asserting the gate's answer.
 * `import-transport.test.ts` owns the desktop's half of this and must keep passing unchanged, which
 * is the "desktop verify still passes" half of the lane's done-when as a test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-local-path-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "7c2e5b91da40f836a1e70c94bd2f5813ae609d47c1b83f0526ea9d74b0135fc8";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_STORAGE;

import { LOCAL_PATH_DISABLED_CODE } from "../handlers/edit";
import { dispatch } from "../router";
import { createSession } from "../auth/session";
import { createMemorySessionStore } from "../auth/session-store";
import type { HostJsonResult, HostRequest, HostResult } from "../types";
import type { SessionStore } from "../auth/session-store";

const T0 = Date.UTC(2026, 8, 21, 11, 0, 0);
const ALPHA = { tenantId: "localpath-tenant-a", orgId: "localpath-org-a", userId: "localpath-user-a" };

let store: SessionStore;
let cookie = "";
let projectId = "";

function json(result: HostResult): HostJsonResult {
  if (result.type !== "json") {
    throw new Error(`expected a json result, got ${result.type}`);
  }
  return result;
}

function body(result: HostResult): Record<string, unknown> {
  return json(result).body as Record<string, unknown>;
}

function errorOf(result: HostResult): { code?: string; message?: string } {
  const payload = body(result).error;
  return typeof payload === "string" ? { code: payload } : ((payload ?? {}) as { code?: string; message?: string });
}

async function send(over: Partial<HostRequest>): Promise<HostResult> {
  return dispatch(
    { method: "GET", path: "/api/v1/storage/usage", query: {}, params: {}, headers: { cookie }, ...over },
    { serverMode: true, sessionStore: store, now: () => T0 },
  );
}

function importWith(body: Record<string, unknown>, transport: string): Promise<HostResult> {
  return send({
    method: "POST",
    path: `/api/v1/edit/projects/${projectId}/import`,
    params: { projectId },
    headers: { cookie, "x-agentforge-transport": transport },
    body,
  });
}

beforeAll(async () => {
  const { db, ensurePortalOwner } = await import("@agentforge/db");
  store = createMemorySessionStore();
  await ensurePortalOwner(db, ALPHA);
  const session = createSession({ ...ALPHA, now: T0 });
  await store.create(session);
  cookie = `__Host-agentforge_session=${session.id}`;

  process.env.AGENTFORGE_SERVER = "1";
  const created = await send({ method: "POST", path: "/api/v1/edit/projects", body: { title: "p" } });
  projectId = ((body(created).project as { id: string } | undefined)?.id ?? body(created).id) as string;
  expect(typeof projectId).toBe("string");
  delete process.env.AGENTFORGE_SERVER;
});

beforeEach(() => {
  process.env.AGENTFORGE_SERVER = "1";
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("sourcePath in server mode", () => {
  it("refuses with its own code, over IPC as well as over http", async () => {
    for (const transport of ["http", "web", "ipc"]) {
      const result = await importWith({ sourcePath: "/etc/passwd" }, transport);
      expect(json(result).status, transport).toBe(403);
      // IPC too, on purpose: the transport header is a claim the caller makes, and on a hosted box
      // there is no packaged shell to make it honestly. The refusal is checked BEFORE the transport
      // rule, so a forged header cannot reach the `readFile` below it.
      expect(errorOf(result).code, transport).toBe(LOCAL_PATH_DISABLED_CODE);
    }
  });

  it("does not answer with the gateway's code, which would send the tenant to the wrong screen", async () => {
    const result = await importWith({ sourcePath: "/tmp/talk.mp4" }, "web");
    // `gateway_blocked` routes the renderer to the paste-your-key screen; `invalid_request` reads
    // as a typo. Neither says "the hosted service does not do this".
    expect(errorOf(result).code).not.toBe("gateway_blocked");
    expect(errorOf(result).code).not.toBe("invalid_request");
  });

  it("says what to do instead, and names no path of its own", async () => {
    const message = errorOf(await importWith({ sourcePath: "/srv/secret.mp4" }, "web")).message;
    expect(message).toMatch(/upload/i);
    // It echoes nothing about the server's own filesystem, and nothing of the path it was handed.
    expect(message).not.toContain("/srv");
  });

  it("refuses before it reads anything, so a path that exists is no different", async () => {
    // The data directory is a real, readable path on this machine. A refusal that depended on the
    // file being missing would be no refusal at all.
    const result = await importWith({ sourcePath: join(dataDir, "..") }, "ipc");
    expect(errorOf(result).code).toBe(LOCAL_PATH_DISABLED_CODE);
  });

  it("leaves an upload alone: only the path spelling is refused", async () => {
    const result = await importWith({}, "web");
    // Whatever this answers — a missing file is still a bad request — it is not the path refusal.
    expect(errorOf(result).code).not.toBe(LOCAL_PATH_DISABLED_CODE);
  });

  it("keeps the desk's own answer off the hosted server", async () => {
    delete process.env.AGENTFORGE_SERVER;
    // A desk project, owned by the local tenant: the hosted project above is another tenant's and
    // would 404 here for that reason rather than for the one under test.
    const { seedEditProject } = await import("./harness");
    const { project } = await seedEditProject("local-path-desk");
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/import`,
      query: {},
      params: { projectId: project.id },
      headers: { "x-agentforge-transport": "http" },
      body: { sourcePath: "/tmp/talk.mp4" },
    });
    // The rule the desktop and webdev have always had, unchanged: a 400 from the transport check.
    expect(json(result).status).toBe(400);
    expect(errorOf(result).code).toBe("invalid_request");
  });
});
