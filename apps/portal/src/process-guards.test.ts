/**
 * The process-level last resort: an unhandled rejection or an uncaught exception is written through
 * the portal's own logger (so it is redacted like every other line), and the process then exits
 * non-zero rather than carrying on in a state nobody can describe.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createLogger, REDACTED_MARKER } from "./log";
import { installProcessGuards } from "./process-guards";

function harness() {
  const lines: string[] = [];
  const log = createLogger({ env: {}, sink: (_level, line) => lines.push(line) });
  const target = new EventEmitter();
  const exit = vi.fn();
  installProcessGuards({ target, log, exit });
  const records = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { target, exit, records };
}

describe("installProcessGuards", () => {
  it("writes an unhandled rejection through the portal logger, then exits 1", () => {
    const { target, exit, records } = harness();

    // A settled promise stands in for the one Node would pass; a real rejected one here would be
    // an unhandled rejection of this test's own.
    target.emit("unhandledRejection", new TypeError("Invalid URL"), Promise.resolve());

    expect(records()).toEqual([
      expect.objectContaining({
        level: "error",
        event: "portal_unhandled_rejection",
        reason: "TypeError: Invalid URL",
      }),
    ]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("writes an uncaught exception the same way, then exits 1", () => {
    const { target, exit, records } = harness();

    target.emit("uncaughtException", new RangeError("boom"), "uncaughtException");

    expect(records()).toEqual([
      expect.objectContaining({
        level: "error",
        event: "portal_uncaught_exception",
        reason: "RangeError: boom",
      }),
    ]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("scrubs a token-shaped value out of the reason, as the sink does for every line", () => {
    const { target, records } = harness();
    const token = "A".repeat(43);

    target.emit("unhandledRejection", new Error(`refresh ${token} refused`), Promise.resolve());

    const [record] = records();
    expect(String(record.reason)).not.toContain(token);
    expect(String(record.reason)).toContain(REDACTED_MARKER);
  });

  it("names the type of a rejection that is not an Error, and never prints its value", () => {
    const { target, exit, records } = harness();

    target.emit("unhandledRejection", "654321", Promise.resolve());
    target.emit("unhandledRejection", { otp: "654321" }, Promise.resolve());

    const reasons = records().map((record) => record.reason);
    expect(reasons).toEqual(["non-error value (string)", "non-error value (object)"]);
    expect(JSON.stringify(records())).not.toContain("654321");
    expect(exit).toHaveBeenCalledTimes(2);
  });

  it("still exits when the logger itself throws", () => {
    const target = new EventEmitter();
    const exit = vi.fn();
    const broken = createLogger({
      env: {},
      sink: () => {
        throw new Error("EPIPE");
      },
    });
    installProcessGuards({ target, log: broken, exit });

    expect(() => target.emit("uncaughtException", new Error("boom"), "uncaughtException")).not.toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("installs exactly one listener per event", () => {
    const { target } = harness();
    expect(target.listenerCount("unhandledRejection")).toBe(1);
    expect(target.listenerCount("uncaughtException")).toBe(1);
  });
});
