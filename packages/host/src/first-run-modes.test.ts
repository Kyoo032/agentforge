/**
 * The hard rule (owner decision, Rizky, 2026-09-29): the first desk of a fresh Personal install has
 * Research, Images, Videos and Presentation, plus the Chat home, and no other mode.
 *
 * Nothing here mocks the constant or the database. Part one opens a real, empty data dir through the
 * real router, so the desk is created by the same `getTenant` -> `ensureLocalOwner` walk a packaged
 * app makes on its first request. Part two runs two real host processes against one data dir to prove
 * that Start over ("all") brings the desk back the same way.
 *
 * The expected list is written out literally so that a change to `FIRST_RUN_MODES`, or a new catalog
 * mode, fails here instead of quietly joining a first-run desk. To change the rule, change this list
 * in the same commit as the owner's decision.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "./__fixtures__/test-budgets";
import type { HostRequest, HostResult } from "./types";

const FIRST_RUN_DESK = ["chat", "research", "images", "videos", "presentations"];
/** What `widen` sends: the whole catalog, in catalog order. Written out for the same reason as the list above. */
const EVERY_MODE = [
  "chat",
  "documents",
  "research",
  "finance",
  "data",
  "market",
  "legal",
  "meeting",
  "images",
  "videos",
  "music",
  "edit",
  "presentations",
  "education",
];

// One desk per file; the personal packaged app has no HTTP port and no hosted switch.
const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-first-run-modes-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_SECRETS_KEY = "d".repeat(64);
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;

type Desk = { id: string; name: string; slug: string; productModes: string[]; protected: boolean };
type DeskList = { workspaces: Desk[]; currentWorkspaceId: string };
type PatchAnswer = { workspace: { productModes: string[] } };

async function json<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const result = await dispatch({ method, path, query: {}, params: {}, headers: {}, body });
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: (result.body ?? {}) as T };
}

async function desks(): Promise<DeskList> {
  const answer = await json<DeskList>("GET", "/api/v1/workspaces");
  expect(answer.status).toBe(200);
  return answer.body;
}

/** The one desk of a fresh install. Fails loudly, rather than with an `undefined`, when it is not there. */
async function onlyDesk(): Promise<Desk> {
  const [first, ...rest] = (await desks()).workspaces;
  if (!first || rest.length > 0) {
    throw new Error(`expected exactly one desk, found ${rest.length + (first ? 1 : 0)}`);
  }
  return first;
}

beforeAll(async () => {
  ({ dispatch } = await import("./router"));
}, ROUTER_IMPORT_BUDGET_MS);

afterAll(async () => {
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("a fresh Personal data dir, through the real first-run path", () => {
  it("has no desk before the first request", async () => {
    // The desk is created lazily by the first request; a leftover row would make this test vacuous.
    const { sql } = await import("@agentforge/db");
    const count = sql.prepare("SELECT count(*) AS n FROM workspaces").get() as { n: number };
    expect(count.n).toBe(0);
    expect(existsSync(path.join(dataDir, "settings.enc"))).toBe(false);
  });

  it("creates exactly one desk, Default, with exactly Chat, Research, Images, Videos and Presentation", async () => {
    const { workspaces, currentWorkspaceId } = await desks();

    expect(workspaces).toHaveLength(1);
    const first = await onlyDesk();
    expect(first.slug).toBe("home");
    expect(first.id).toBe(currentWorkspaceId);
    expect(first.productModes).toEqual(FIRST_RUN_DESK);
  });

  it("stores that list on the row itself, not only in what the API resolves", async () => {
    const { sql } = await import("@agentforge/db");
    const row = sql.prepare("SELECT product_modes AS modes FROM workspaces WHERE slug = 'home'").get() as {
      modes: string | null;
    };

    expect(row.modes).not.toBeNull();
    expect(JSON.parse(row.modes as string)).toEqual(FIRST_RUN_DESK);
  });

  it("has no other mode set: nothing outside the list, and every one of the list", async () => {
    const first = await onlyDesk();
    const outside = first.productModes.filter((id) => !FIRST_RUN_DESK.includes(id));
    const absent = FIRST_RUN_DESK.filter((id) => !first.productModes.includes(id));

    expect(outside).toEqual([]);
    expect(absent).toEqual([]);
  });

  it("is the same on the next request: an existing desk is read, never rewritten", async () => {
    const before = await onlyDesk();
    const after = await onlyDesk();

    expect(after.productModes).toEqual(before.productModes);
    expect(after.id).toBe(before.id);
  });

  it("lets the owner add the rest later: Workspaces PATCHes this desk's modes", async () => {
    const first = await onlyDesk();
    const widened = [...FIRST_RUN_DESK, "documents", "finance"];

    const saved = await json<PatchAnswer>("PATCH", `/api/v1/workspaces/${first.id}`, { productModes: widened });

    expect(saved.status).toBe(200);
    expect(saved.body.workspace.productModes).toEqual([
      "chat",
      "documents",
      "research",
      "finance",
      "images",
      "videos",
      "presentations",
    ]);
    expect((await onlyDesk()).productModes).toEqual(saved.body.workspace.productModes);
  });
});

/** One line a child step printed. Every field is optional because each step prints its own. */
type ChildRow = {
  step: string;
  desk?: { slug: string; productModes: string[] };
  stored?: string[] | null;
  status?: number;
  relaunch?: boolean | null;
  guide?: { seen: boolean; outcome: string | null; at: number | null } | null;
};

/**
 * Start over ("all") queues `reset-pending.json`; the next process removes the database before it
 * opens SQLite, and the first request after that creates the desk again. Two child processes, one
 * data dir, exactly as the packaged app and webdev do it (`AGENTFORGE_APPLY_PENDING_RESET=1`).
 */
describe("Start over re-creates the first desk with the first-run modes", () => {
  const REPO = path.resolve(__dirname, "..", "..", "..");
  const CHILD = path.join(REPO, "packages", "host", "test", "first-run-child.ts");
  // tsx's own JS entry, run by this Node; `.bin/tsx` is a POSIX shim Windows cannot execute.
  const TSX_CLI = createRequire(path.join(REPO, "package.json")).resolve("tsx/cli");
  const wipedDir = mkdtempSync(path.join(tmpdir(), "agentforge-first-run-startover-"));

  /**
   * Asynchronous on purpose. A synchronous spawn blocks this worker's event loop for as long as the
   * child runs (20 s idle, more when the whole package is running beside it), and vitest's worker
   * cannot answer its own coordinator while blocked: `Timeout calling "onTaskUpdate"` failed a full
   * host run whose 2919 tests all passed.
   */
  async function child(steps: string[], extraEnv: Record<string, string> = {}): Promise<ChildRow[]> {
    const { stdout } = await promisify(execFile)(process.execPath, [TSX_CLI, CHILD, ...steps], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 170_000,
      env: {
        ...process.env,
        AGENTFORGE_DATA_DIR: wipedDir,
        AGENTFORGE_SECRETS_KEY: "e".repeat(64),
        AGENTFORGE_RUNTIME: "stub",
        // Never inherit the operator's environment into a process that writes a database.
        AGENTFORGE_SERVER: "",
        AGENTFORGE_APPLY_PENDING_RESET: "",
        DATABASE_URL: "",
        MEDIA_ROOT: path.join(wipedDir, "media"),
        ...extraEnv,
      },
    });
    // Only the child's own `ROW ` lines: the host writes info logs to stdout too.
    return stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("ROW "))
      .map((line) => JSON.parse(line.slice(4)) as ChildRow);
  }

  afterAll(() => {
    rmSync(wipedDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("first boot, widen the desk to every mode, queue the wipe; second boot applies it and starts narrow again", async () => {
    const first = await child(["desk", "widen", "desk", "guide", "finish-guide", "guide", "startover"]);

    expect(first[0]?.desk?.productModes).toEqual(FIRST_RUN_DESK);
    expect(first[0]?.stored).toEqual(FIRST_RUN_DESK);
    expect(first[1]?.status).toBe(200);
    expect(first[2]?.desk?.productModes).toEqual(EVERY_MODE);
    // The guide has not been seen, is recorded as finished, and reads back as seen.
    expect(first[3]?.guide).toEqual({ seen: false, outcome: null, at: null });
    expect(first[4]?.status).toBe(200);
    expect(first[5]?.guide).toMatchObject({ seen: true, outcome: "finished" });
    expect(first[6]?.relaunch).toBe(true);
    expect(existsSync(path.join(wipedDir, "reset-pending.json"))).toBe(true);

    const second = await child(["desk", "guide"], { AGENTFORGE_APPLY_PENDING_RESET: "1" });

    expect(existsSync(path.join(wipedDir, "reset-pending.json"))).toBe(false);
    expect(second[0]?.desk?.slug).toBe("home");
    expect(second[0]?.desk?.productModes).toEqual(FIRST_RUN_DESK);
    expect(second[0]?.stored).toEqual(FIRST_RUN_DESK);
    // Start over removes settings.enc, and the guide record with it: the tour is offered again.
    expect(second[1]?.guide).toEqual({ seen: false, outcome: null, at: null });
  }, 340_000);

  it("a reboot with no wipe queued leaves an owner-edited desk exactly as it was", async () => {
    await child(["desk", "widen"]);

    const again = await child(["desk"]);

    expect(again[0]?.desk?.productModes).toEqual(EVERY_MODE);
  }, 340_000);
});
