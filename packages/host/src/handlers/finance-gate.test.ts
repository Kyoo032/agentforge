/**
 * The three Finance routes a closed gateway gate must NOT stop.
 *
 * `/export`, `/docx` and `/import` never call the gateway: they re-render a report the owner
 * already has, or read a file off their own machine. Gating them would mean an unvalidated or
 * expired key locking the owner out of their own figures, which is the one failure mode a
 * local-first product cannot have. This pins that decision — and, in the same run, proves the gate
 * really is closed, so a green result here can never just mean "nothing was gated anywhere".
 *
 * The gate is closed the way `handlers/settings.test.ts` closes it: by dropping the stub runtime
 * inside the test, since `test/setup.ts` puts it back before every module.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";
import { writeWorkbook } from "@agentforge/core/tabular";
import type { HostFile, HostRequest, HostResult } from "../types";

// Isolation: "is really closed" needs a desk that has never held a gateway key, so this file brings
// its own data dir, set before the router is imported, instead of sharing whatever else ran here.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-finance-gate-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;

type Dispatch = (request: HostRequest) => Promise<HostResult>;
let dispatch: Dispatch;

const STUB = process.env.AGENTFORGE_RUNTIME;

function request(path: string, extra: Partial<HostRequest> = {}): HostRequest {
  return { method: "POST", path, query: {}, params: {}, headers: {}, ...extra };
}

/** The flat `{ error: "gateway_blocked" }` body `parseGatewayBlocked` reads, or "" for anything else. */
function blockedCode(result: HostResult): string {
  if (result.type !== "json") {
    return "";
  }
  return (result.body as { error?: unknown } | null)?.error === "gateway_blocked" ? "gateway_blocked" : "";
}

function statusOf(result: HostResult): number {
  return result.type === "json" ? result.status : 200;
}

const BOOK = writeWorkbook([
  {
    name: "Summary",
    rows: [
      ["Label", "Amount"],
      ["Revenue", 120000],
    ],
  },
]);

function upload(filename: string, bytes: Uint8Array): HostFile {
  return { field: "file", filename, mime: "application/octet-stream", bytes };
}

const BRIEF = {
  title: "FY2025",
  summary: ["Revenue was 120000."],
  sections: [{ heading: "Margin", body: "Revenue was 120000." }],
};

beforeAll(async () => {
  ({ dispatch } = await import("../router"));
}, ROUTER_IMPORT_BUDGET_MS);

afterEach(() => {
  process.env.AGENTFORGE_RUNTIME = STUB ?? "stub";
});

afterAll(async () => {
  // The router opened the kernel SQLite inside dataDir. Windows will not delete a file something
  // still holds, so that handle is closed before the dir goes.
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("the gateway gate and the Finance file routes", () => {
  it("is really closed, so the assertions below mean something", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    const result = await dispatch(request("/api/v1/finance", { body: { task: "brief", prompt: "x", items: [] } }));

    expect(blockedCode(result)).toBe("gateway_blocked");
    expect(statusOf(result)).toBe(403);
  });

  it("still lets the owner export, render Word and read a file with the gate shut", async () => {
    delete process.env.AGENTFORGE_RUNTIME;
    const calls: ReadonlyArray<readonly [string, Partial<HostRequest>]> = [
      ["/api/v1/finance/export", { body: { brief: BRIEF, format: "markdown" } }],
      ["/api/v1/finance/docx", { body: { brief: BRIEF } }],
      ["/api/v1/finance/import", { files: [upload("book.xlsx", BOOK)] }],
    ];
    for (const [path, extra] of calls) {
      const result = await dispatch(request(path, extra));
      expect(blockedCode(result), path).toBe("");
      expect(statusOf(result), path).not.toBe(403);
    }
  });
});
