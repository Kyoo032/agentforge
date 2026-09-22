/**
 * The bug this file exists for, found by driving Meeting on the live desk on 2026-09-21:
 *
 * `timeoutForMedia(durationSeconds)` multiplies a probed duration — `65.556063` seconds for a real
 * recording — into milliseconds, so it handed `execFile` a timeout of `161112.126`. Node refuses a
 * fractional timeout with `ERR_OUT_OF_RANGE` *before spawning anything*, and the catch-all below it
 * reported that as `ffmpeg_failed` / "ffmpeg recipe failed". Every meeting whose audio was not a
 * whole number of seconds long died at the `extracting` phase with an error that blamed ffmpeg for
 * a request ffmpeg never received.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { runFfmpeg, setExecFileForTests } from "./run";

vi.mock("../ffmpeg-binary", () => ({
  resolveFfmpeg: () => ({ found: true, path: "ffmpeg", version: "8.1.1" }),
  resolveFfprobe: () => ({ found: true, path: "ffprobe", version: "8.1.1" }),
}));

afterEach(() => {
  setExecFileForTests(null);
});

function timeoutRecorder(): { seen: number[]; install: () => void } {
  const seen: number[] = [];
  return {
    seen,
    install: () =>
      setExecFileForTests(async (_file: string, _args: unknown, options: { timeout?: number }) => {
        seen.push(options.timeout ?? Number.NaN);
        return { stdout: "", stderr: "" };
      }),
  };
}

describe("runFfmpeg timeouts", () => {
  it("hands execFile a whole number of milliseconds for a fractional media duration", async () => {
    const recorder = timeoutRecorder();
    recorder.install();
    await runFfmpeg(["-version"], { timeoutMs: 2 * 65.556063 * 1000 + 30_000 });
    expect(recorder.seen).toHaveLength(1);
    expect(Number.isInteger(recorder.seen[0])).toBe(true);
    expect(recorder.seen[0]).toBe(161_113);
  });

  it("never rounds a positive timeout down to zero, which would mean no timeout at all", async () => {
    const recorder = timeoutRecorder();
    recorder.install();
    await runFfmpeg(["-version"], { timeoutMs: 0.4 });
    expect(recorder.seen[0]).toBe(1);
  });

  it("leaves a timeout that is already whole alone", async () => {
    const recorder = timeoutRecorder();
    recorder.install();
    await runFfmpeg(["-version"], { timeoutMs: 15_000 });
    expect(recorder.seen[0]).toBe(15_000);
  });
});

/**
 * These two cases used to assert that the binary's own words — `ENOENT`, the stderr tail, Node's
 * `out of range` sentence — reached the caller. That is exactly the leak
 * `run-failure-detail.test.ts` now forbids: the same message is serialised to the browser and
 * streamed as Meeting's SSE `job.error`. What a caller is owed is a REASON, and the reason has to
 * be specific enough that the fractional-timeout bug above would still have been findable from it.
 */
describe("runFfmpeg failure reporting", () => {
  it("says why the recipe failed, in a class rather than in the tool's own words", async () => {
    setExecFileForTests(async () => {
      const error = new Error("Command failed") as NodeJS.ErrnoException & { stderr?: string };
      error.code = "ENOENT";
      error.stderr = "Unknown encoder 'libmp3lame'";
      throw error;
    });
    const failure = await runFfmpeg(["-i", "in.wav"], { timeoutMs: 1000 }).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "ffmpeg_failed" });
    expect((failure as Error).message).toBe("ffmpeg could not process that media (the tool could not be started)");
  });

  it("separates a codec this build lacks from a file that cannot be read", async () => {
    setExecFileForTests(async () => {
      throw Object.assign(new Error("Command failed"), { code: 1, stderr: "Unknown encoder 'libmp3lame'" });
    });
    const failure = await runFfmpeg(["-i", "in.wav"], { timeoutMs: 1000 }).catch((error: unknown) => error);
    expect((failure as Error).message).toBe("ffmpeg could not process that media (an unsupported codec)");
  });

  it("names Node's own refusal as a bad request rather than blaming the file", async () => {
    // The bug at the top of this file, as it would arrive today: `ERR_OUT_OF_RANGE`, raised before
    // anything is spawned. "an invalid run request" points at the caller, which is where it was.
    setExecFileForTests(async () => {
      const error = new Error('The value of "timeout" is out of range.') as NodeJS.ErrnoException;
      error.code = "ERR_OUT_OF_RANGE";
      throw error;
    });
    const failure = await runFfmpeg(["-version"], { timeoutMs: 1000 }).catch((error: unknown) => error);
    expect((failure as Error).message).toBe("ffmpeg could not process that media (an invalid run request)");
  });
});
