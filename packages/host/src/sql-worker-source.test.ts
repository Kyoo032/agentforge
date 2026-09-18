import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqliteModulePath } from "./sql-runner";
import { SQL_WORKER_SOURCE } from "./sql-worker-source";

/**
 * The dataset runner executes SQL the *user* wrote, by design — so the sandbox is the control,
 * not the statement. `assertReadOnlySql` is the first layer and is pinned in sql-guard.test.ts;
 * this file proves the second one by talking to the worker directly, exactly as a bypassed or
 * future-broken guard would. Nothing here goes through `createQueryRunner`, so a passing run
 * means the worker itself refuses the statement.
 */

const WORKER_TIMEOUT_MS = 30_000;

type QueryAnswer = { ok: boolean; error?: string; result?: { rows: unknown[][] } };

const LOAD = {
  ddl: "CREATE TABLE data (a INTEGER, b TEXT)",
  insertSql: "INSERT INTO data (a, b) VALUES (?, ?)",
  rows: [
    [1, "one"],
    [2, "two"],
  ],
  heapLimit: 16 * 1024 * 1024,
};

let worker: Worker;

function ask(sql: string): Promise<QueryAnswer> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.off("message", onMessage);
      reject(new Error(`worker never answered ${sql}`));
    }, WORKER_TIMEOUT_MS);
    const onMessage = (message: { type?: string; id?: string } & QueryAnswer) => {
      if (message?.type !== "result" || message.id !== id) {
        return;
      }
      clearTimeout(timer);
      worker.off("message", onMessage);
      resolve(message);
    };
    worker.on("message", onMessage);
    worker.postMessage({ type: "query", id, sql, rowCap: 500, cellMax: 400 });
  });
}

beforeAll(async () => {
  worker = new Worker(SQL_WORKER_SOURCE, { eval: true });
  await new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", (message: { type?: string }) =>
      message?.type === "loaded" ? resolve() : reject(new Error("worker did not load")),
    );
    worker.postMessage({ type: "load", modulePath: sqliteModulePath(), ...LOAD });
  });
}, WORKER_TIMEOUT_MS);

afterAll(async () => {
  await worker.terminate();
});

/** Statements that must never run, with the layer that is expected to stop each one. */
const REFUSED: Array<[name: string, sql: string]> = [
  ["a write", "INSERT INTO data (a, b) VALUES (9, 'nine')"],
  ["a delete", "DELETE FROM data"],
  ["a schema change", "CREATE TABLE evil (a INTEGER)"],
  ["a schema drop", "DROP TABLE data"],
  ["attaching the app database", "ATTACH DATABASE '/data/agentforge.sqlite' AS leak"],
  ["attaching any file", "ATTACH DATABASE 'agentforge.sqlite' AS leak"],
  ["rewriting the schema", "PRAGMA writable_schema = 1"],
  ["turning the read-only lock off", "PRAGMA query_only = 0"],
  ["loading an extension", "SELECT load_extension('x')"],
  ["a second statement", "SELECT 1; INSERT INTO data (a, b) VALUES (9, 'nine')"],
  ["a dot command", ".tables"],
];

describe("the dataset SQL worker", () => {
  it.each(REFUSED)("refuses %s", async (_name, sql) => {
    const answer = await ask(sql);
    expect(answer.ok).toBe(false);
    expect(typeof answer.error).toBe("string");
  });

  it("still holds exactly the rows it was loaded with afterwards", async () => {
    const answer = await ask("SELECT count(*) AS c FROM data");
    expect(answer.ok).toBe(true);
    expect(answer.result?.rows).toEqual([[2]]);
  });

  it("opens its database in memory, so no file on disk is reachable", async () => {
    // `pragma_database_list` is blocked by the guard for user SQL; asked directly it is the proof
    // that the only database attached is the anonymous in-memory one the parent built.
    const answer = await ask("SELECT name, file FROM pragma_database_list");
    expect(answer.ok).toBe(true);
    expect(answer.result?.rows).toEqual([["main", ""]]);
  });

  it("caps the rows one answer can carry", async () => {
    const answer = await ask("SELECT a FROM data");
    expect(answer.ok).toBe(true);
    const capped = await new Promise<QueryAnswer>((resolve) => {
      const id = crypto.randomUUID();
      const onMessage = (message: { type?: string; id?: string } & QueryAnswer) => {
        if (message?.type === "result" && message.id === id) {
          worker.off("message", onMessage);
          resolve(message);
        }
      };
      worker.on("message", onMessage);
      worker.postMessage({ type: "query", id, sql: "SELECT a FROM data", rowCap: 1, cellMax: 400 });
    });
    expect(capped.result?.rows).toHaveLength(1);
  });

  it("caps the characters one cell can carry", async () => {
    const answer = await new Promise<QueryAnswer>((resolve) => {
      const id = crypto.randomUUID();
      const onMessage = (message: { type?: string; id?: string } & QueryAnswer) => {
        if (message?.type === "result" && message.id === id) {
          worker.off("message", onMessage);
          resolve(message);
        }
      };
      worker.on("message", onMessage);
      worker.postMessage({
        type: "query",
        id,
        sql: "SELECT replace(hex(zeroblob(50)), '0', 'x') AS wide",
        rowCap: 500,
        cellMax: 10,
      });
    });
    expect(answer.ok).toBe(true);
    expect(String(answer.result?.rows[0]?.[0])).toHaveLength(11);
  });
});
