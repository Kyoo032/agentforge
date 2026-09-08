import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { killTrackedChildren, resetTrackedChildrenForTests, trackChild, trackedChildCount } from "./child-processes";

class FakeChild extends EventEmitter {
  readonly pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: Array<NodeJS.Signals | number | undefined> = [];
  private readonly onKill: "exit" | "ignore" | "throw";

  constructor(pid: number, onKill: "exit" | "ignore" | "throw" = "exit") {
    super();
    this.pid = pid;
    this.onKill = onKill;
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal);
    if (this.onKill === "throw") {
      throw new Error("ESRCH");
    }
    if (this.onKill === "exit") {
      this.exitCode = null;
      this.signalCode = typeof signal === "string" ? signal : "SIGTERM";
      this.emit("exit", null, this.signalCode);
    }
    return true;
  }
}

afterEach(() => {
  resetTrackedChildrenForTests();
});

describe("trackChild", () => {
  it("counts a live child and forgets it on exit", () => {
    const child = new FakeChild(101);
    trackChild(child);
    expect(trackedChildCount()).toBe(1);
    child.emit("exit", 0, null);
    expect(trackedChildCount()).toBe(0);
  });

  it("ignores children without a pid or already exited", () => {
    const noPid = new FakeChild(0);
    Object.defineProperty(noPid, "pid", { value: undefined });
    trackChild(noPid);
    const done = new FakeChild(102);
    done.exitCode = 0;
    trackChild(done);
    expect(trackedChildCount()).toBe(0);
  });

  it("tracks the same child once", () => {
    const child = new FakeChild(103);
    trackChild(child);
    trackChild(child);
    expect(trackedChildCount()).toBe(1);
  });
});

describe("killTrackedChildren", () => {
  it("sends the signal to every live child and reports the count", () => {
    const a = new FakeChild(201);
    const b = new FakeChild(202);
    trackChild(a);
    trackChild(b);
    const killed = killTrackedChildren();
    expect(killed).toBe(2);
    expect(a.kills).toEqual(["SIGTERM"]);
    expect(b.kills).toEqual(["SIGTERM"]);
    expect(trackedChildCount()).toBe(0);
  });

  it("accepts a custom signal", () => {
    const child = new FakeChild(203);
    trackChild(child);
    killTrackedChildren("SIGKILL");
    expect(child.kills).toEqual(["SIGKILL"]);
  });

  it("never throws when a child is already gone", () => {
    const gone = new FakeChild(204, "throw");
    const stubborn = new FakeChild(205, "ignore");
    trackChild(gone);
    trackChild(stubborn);
    expect(() => killTrackedChildren()).not.toThrow();
    expect(stubborn.kills).toEqual(["SIGTERM"]);
    expect(trackedChildCount()).toBe(0);
  });

  it("returns 0 when nothing is tracked", () => {
    expect(killTrackedChildren()).toBe(0);
  });
});
