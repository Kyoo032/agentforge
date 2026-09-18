import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@agentforge/core";
import { killTrackedChildren, resetTrackedChildrenForTests, trackedChildCount } from "../../child-processes";
import { createLimiter, ffmpegLimiter, TOO_MANY_JOBS, type Limiter } from "../../concurrency";
import { runFfmpeg, setExecFileForTests, setFfmpegLimiterForTests } from "./run";

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
  setFfmpegLimiterForTests(null);
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

/** An exec implementation that hands back a child per call and finishes only when told. */
function pausedExec() {
  const spawned: FakeChild[] = [];
  const impl = (() => {
    const child = new FakeChild();
    spawned.push(child);
    return execFileWithChild(child);
  }) as never;
  const finish = (child: FakeChild) => child.emit("exit", 0, null);
  return { spawned, impl, finish };
}

/** Lets a released limiter slot hand itself to the next waiter before we look. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("runFfmpeg on a desk", () => {
  it("spawns every encode at once: a desk is never capped and never queues", async () => {
    // The regression this pins. Eight exports used to spawn eight encoders; a global cap turned
    // that into two at a time and made the ninth a 429 the desktop had never produced.
    const { spawned, impl, finish } = pausedExec();
    setExecFileForTests(impl);
    const runs = Array.from({ length: 9 }, () => runFfmpeg(["-version"], { timeoutMs: 1000 }));

    expect(ffmpegLimiter.max).toBe(Number.POSITIVE_INFINITY);
    expect(spawned.length).toBe(9);
    expect(trackedChildCount()).toBe(9);
    expect(ffmpegLimiter.queued()).toBe(0);

    for (const child of spawned) {
      finish(child);
    }
    await Promise.all(runs);
    expect(ffmpegLimiter.active()).toBe(0);
    expect(trackedChildCount()).toBe(0);
  });
});

describe("runFfmpeg under the hosted cap", () => {
  /** The limiter the hosted server builds, without flipping server mode for the whole process. */
  function hostedLimiter(max: number): Limiter {
    const limiter = createLimiter("ffmpeg", max);
    setFfmpegLimiterForTests(limiter);
    return limiter;
  }

  it("spawns up to the cap and queues the rest", async () => {
    const { spawned, impl, finish } = pausedExec();
    setExecFileForTests(impl);
    const limiter = hostedLimiter(2);
    const max = limiter.max;

    const runs = Array.from({ length: max + 1 }, () => runFfmpeg(["-version"], { timeoutMs: 1000 }));
    // The cap is applied before the spawn, synchronously, so the extra encode never starts a process.
    expect(spawned.length).toBe(max);
    expect(trackedChildCount()).toBe(max);
    expect(limiter.active()).toBe(max);
    expect(limiter.queued()).toBe(1);

    finish(spawned[0]);
    await runs[0];
    await settle();
    expect(spawned.length).toBe(max + 1);

    for (const child of spawned.slice(1)) {
      finish(child);
    }
    await Promise.all(runs);
    expect(limiter.active()).toBe(0);
    expect(limiter.queued()).toBe(0);
    expect(trackedChildCount()).toBe(0);
  });

  it("refuses with 429 too_many_jobs when the queue is full as well", async () => {
    const { spawned, impl, finish } = pausedExec();
    setExecFileForTests(impl);
    const limiter = hostedLimiter(2);
    const flood = limiter.max + limiter.queueLimit;

    const runs = Array.from({ length: flood }, () => runFfmpeg(["-version"], { timeoutMs: 1000 }));
    const refused = await runFfmpeg(["-version"], { timeoutMs: 1000 }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).code).toBe(TOO_MANY_JOBS);
    expect((refused as ApiError).status).toBe(429);
    // Refused, not spawned: no extra process, and nothing mistook it for an ffmpeg failure.
    expect(spawned.length).toBe(limiter.max);

    while (spawned.length > 0) {
      const child = spawned.shift();
      if (child) {
        finish(child);
      }
      await settle();
    }
    await Promise.all(runs);
    expect(limiter.active()).toBe(0);
  });
});

describe("runFfmpeg slot hygiene", () => {
  it("frees the slot when a run fails", async () => {
    setExecFileForTests((() => Promise.reject(Object.assign(new Error("exit 1"), { code: 1 }))) as never);
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).rejects.toBeInstanceOf(ApiError);
    expect(ffmpegLimiter.active()).toBe(0);

    setExecFileForTests((async () => ({ stdout: "ok", stderr: "" })) as never);
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).resolves.toEqual({ stdout: "ok", stderr: "" });
    expect(ffmpegLimiter.active()).toBe(0);
  });
});
