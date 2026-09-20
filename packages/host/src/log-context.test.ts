/**
 * Phase 3 lane E, security spec row L1 — the logger's ambient request context.
 *
 * `dispatch` (`./router.ts`) opens `withLogContext` around every hosted handler with the verified
 * session's tenant id, so every line that handler or anything it awaits writes names the tenant it
 * was written for, without 300 call sites having to thread a logger of their own. This file proves
 * the mechanism; `./tenant-log-scope.test.ts` proves `dispatch` actually opens it.
 *
 * A separate file from `./log.test.ts` on purpose: that one carries literal NUL bytes for its
 * redaction cases, so git treats it as binary and any change to it lands as an unreviewable blob.
 */
import { describe, expect, it } from "vitest";
import { type LogLevel, createLogger, currentLogContext, withLogContext } from "./log";

type Line = { level: LogLevel; record: Record<string, unknown> };

function recorder() {
  const lines: string[] = [];
  const sink = (level: LogLevel, line: string) => {
    lines.push(`${level} ${line}`);
  };
  const parsed = (): Line[] =>
    lines.map((entry) => {
      const [level, line] = entry.split(" ");
      return { level: level as LogLevel, record: JSON.parse(line) as Record<string, unknown> };
    });
  return { sink, lines, parsed };
}

describe("the ambient request context", () => {
  it("stamps its fields on every line written inside it", async () => {
    const rec = recorder();
    const logger = createLogger({ sink: rec.sink, env: {} });
    await withLogContext({ tenantId: "tenant-a", route: "/api/v1/threads/:threadId" }, async () => {
      logger.info("thread_read");
      logger.warn("thread_slow", { ms: 900 });
    });
    expect(rec.parsed().map((line) => line.record)).toEqual([
      expect.objectContaining({ event: "thread_read", tenantId: "tenant-a", route: "/api/v1/threads/:threadId" }),
      expect.objectContaining({ event: "thread_slow", tenantId: "tenant-a", ms: 900 }),
    ]);
  });

  it("reaches across an await, which is the whole point of it", async () => {
    const rec = recorder();
    const logger = createLogger({ sink: rec.sink, env: {} });
    const deep = async () => {
      await Promise.resolve();
      logger.info("from_deep");
    };
    await withLogContext({ tenantId: "tenant-a" }, deep);
    expect(rec.parsed()[0]?.record).toMatchObject({ event: "from_deep", tenantId: "tenant-a" });
  });

  it("adds nothing outside a request, so the desktop's lines are unchanged", () => {
    const rec = recorder();
    createLogger({ sink: rec.sink, env: {} }).info("desktop_line", { runId: "r1" });
    expect(Object.keys(rec.parsed()[0]?.record ?? {}).sort()).toEqual(["event", "level", "runId", "ts"]);
    expect(currentLogContext()).toEqual({});
  });

  it("lets the call site win over the ambient field, as it already does over a child field", async () => {
    const rec = recorder();
    const logger = createLogger({ sink: rec.sink, env: {} });
    await withLogContext({ tenantId: "ambient" }, async () => {
      logger.info("explicit_wins", { tenantId: "from-the-call-site" });
    });
    expect(rec.parsed()[0]?.record).toMatchObject({ tenantId: "from-the-call-site" });
  });

  it("puts a child logger's bound fields above the ambient ones", async () => {
    const rec = recorder();
    const logger = createLogger({ sink: rec.sink, env: {} }).child({ route: "/child" });
    await withLogContext({ tenantId: "tenant-a", route: "/ambient" }, async () => {
      logger.info("child_wins");
    });
    expect(rec.parsed()[0]?.record).toMatchObject({ tenantId: "tenant-a", route: "/child" });
  });

  it("does not leak out of the scope it was opened in", async () => {
    const rec = recorder();
    const logger = createLogger({ sink: rec.sink, env: {} });
    await withLogContext({ tenantId: "tenant-a" }, async () => {
      logger.info("inside");
    });
    logger.info("after");
    expect(rec.parsed()[1]?.record.tenantId).toBeUndefined();
  });

  it("nests, so an inner scope adds to the outer one rather than replacing it", async () => {
    const rec = recorder();
    const logger = createLogger({ sink: rec.sink, env: {} });
    await withLogContext({ tenantId: "tenant-a" }, async () => {
      await withLogContext({ route: "/api/v1/ping" }, async () => {
        logger.info("nested");
      });
    });
    expect(rec.parsed()[0]?.record).toMatchObject({ tenantId: "tenant-a", route: "/api/v1/ping" });
  });

  it("still drops a forbidden field name when it arrives from the ambient context", async () => {
    // The redaction rules are the floor, and the ambient layer sits under them, not beside them:
    // a field named for a credential is dropped whoever set it.
    const rec = recorder();
    const logger = createLogger({ sink: rec.sink, env: {} });
    await withLogContext({ tenantId: "tenant-a", sessionId: "s-123" }, async () => {
      logger.info("redacted");
    });
    expect(rec.parsed()[0]?.record).toMatchObject({ tenantId: "tenant-a", sessionId: "[dropped]" });
  });
});
