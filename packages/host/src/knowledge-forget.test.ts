import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@agentforge/core";
import type { KnowledgeBackend } from "./knowledge/backend";

/**
 * `forgetInBackend` is fire-and-forget: the SQLite rows are already gone, so a backend that cannot
 * forget its index must be logged, never thrown. A backend method that throws *synchronously*
 * bypasses the `.catch` on the returned promise entirely, which is the regression pinned here.
 */

const failing: KnowledgeBackend = {
  id: "builtin",
  indexSource: () => Promise.resolve(),
  // Deliberately a sync throw from a declared-Promise method: the shape a non-async SQLite call has.
  deleteSource: (() => {
    throw new Error("backend index unreachable");
  }) as KnowledgeBackend["deleteSource"],
  retrieve: () =>
    Promise.resolve({ chunks: [], mode: "none" as const, backend: "builtin" as const, vectorModel: null }),
  health: () => Promise.resolve({ ok: true }),
};

// `deleteThroughBackend` is what `forgetInBackend` calls now; it stands in for the registry's
// "ask every backend that could hold this source" step, and here the first one throws synchronously.
vi.mock("./knowledge/registry", () => ({
  getKnowledgeBackend: () => failing,
  deleteThroughBackend: (tenant: TenantContext, sourceId: string) => failing.deleteSource(tenant, sourceId),
  indexThroughBackend: () => Promise.resolve(),
  retrieveThroughBackend: () =>
    Promise.resolve({ chunks: [], mode: "none" as const, backend: "builtin" as const, vectorModel: null }),
}));

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: "org-forget",
    workspaceId: `ws-forget-${crypto.randomUUID()}`,
    userId: "user-forget",
    role: "owner",
  };
}

describe("forgetting a source when the backend is broken", () => {
  let previousRuntime: string | undefined;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    process.env.AGENTFORGE_RUNTIME = "stub";
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    vi.restoreAllMocks();
  });

  it("still deletes the row when the backend delete throws", async () => {
    const { addPastedSource, deleteSource, listSources } = await import("./knowledge");
    const ctx = tenant();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const source = await addPastedSource(ctx, "Doomed", "Some indexed body text.");

    expect(() => deleteSource(ctx, source.id)).not.toThrow();
    expect(listSources(ctx).map((item) => item.id)).not.toContain(source.id);
    expect(warn).toHaveBeenCalled();
    // The dynamic import above pulls the whole knowledge module graph (pdfjs-dist included) inside
    // the test body, so this budget is module loading under a loaded machine, not the assertion.
  }, 30_000);

  it("keeps the builtin backend's delete rejecting rather than throwing synchronously", async () => {
    const { SqliteBuiltinBackend } = await import("./knowledge/backends/builtin");
    const backend = new SqliteBuiltinBackend();
    // An unbindable workspace id makes better-sqlite3 throw where the driver would on a real fault.
    const result = backend.deleteSource({ ...tenant(), workspaceId: {} as unknown as string }, "s1");
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toThrow();
  }, 30_000);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
