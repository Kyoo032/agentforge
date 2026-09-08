import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { killTrackedChildren, resetTrackedChildrenForTests, trackedChildCount } from "../../child-processes";
import { runFfmpeg, setExecFileForTests } from "./run";

vi.mock("../ffmpeg-binary", () => ({
  resolveFfmpeg: () => ({ found: true, path: "/fake/ffmpeg", version: "7.0" }),
  resolveFfprobe: () => ({ found: true, path: "/fake/ffprobe", version: "7.0" }),
}));

class FakeChild extends EventEmitter {
  readonly pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kills: Array<NodeJS.Signals | number | undefined> = [];

  kill(signal?: NodeJS.Signals | number): boolean {
    this.kills.push(signal);
    this.signalCode = "SIGTERM";
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

/** Mirrors util.promisify(execFile): the pending promise carries the ChildProcess as `child`. */
function execFileWithChild(child: FakeChild) {
  const pending = new Promise<{ stdout: string; stderr: string }>((resolve) => {
    child.once("exit", () => resolve({ stdout: "", stderr: "" }));
  });
  return Object.assign(pending, { child });
}

afterEach(() => {
  setExecFileForTests(null);
  resetTrackedChildrenForTests();
});

describe("runFfmpeg child tracking", () => {
  it("registers the spawned process while it runs and forgets it on exit", async () => {
    const child = new FakeChild();
    setExecFileForTests((() => execFileWithChild(child)) as never);
    const run = runFfmpeg(["-version"], { timeoutMs: 1000 });
    expect(trackedChildCount()).toBe(1);
    child.emit("exit", 0, null);
    await run;
    expect(trackedChildCount()).toBe(0);
  });

  it("lets the host kill a running ffmpeg on quit", async () => {
    const child = new FakeChild();
    setExecFileForTests((() => execFileWithChild(child)) as never);
    const run = runFfmpeg(["-i", "in.mp4", "out.mp4"], { timeoutMs: 1000 });
    expect(trackedChildCount()).toBe(1);
    expect(killTrackedChildren()).toBe(1);
    expect(child.kills).toEqual(["SIGTERM"]);
    await run;
    expect(trackedChildCount()).toBe(0);
  });

  it("still works when the exec implementation exposes no child", async () => {
    setExecFileForTests((async () => ({ stdout: "", stderr: "" })) as never);
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).resolves.toEqual({ stdout: "", stderr: "" });
    expect(trackedChildCount()).toBe(0);
  });
});
