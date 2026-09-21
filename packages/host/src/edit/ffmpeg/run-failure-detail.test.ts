/**
 * What a failed ffmpeg run is allowed to tell the person who provoked it.
 *
 * `runFfmpeg` used to put `execFile`'s own message — the absolute path of the binary followed by
 * every argument — plus 300 characters of raw stderr into the `ApiError` it threw. That error is
 * not internal: `jsonError` serialises it to the browser, and Meeting streams it as an SSE
 * `job.error` frame. So a tenant who uploaded a broken file was handed the server's filesystem
 * layout, the data directory, and the storage prefix of whichever tenant's media was being read —
 * from one deliberately malformed upload, with no session but their own.
 *
 * The rule these cases hold is narrow and checkable: **nothing the child process wrote, and no
 * path, reaches the client.** The reason class is chosen from the failure, never copied out of it,
 * and the operator still gets everything in the log.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { runFfmpeg, setExecFileForTests } from "./run";

/** A rejection shaped like the one `util.promisify(execFile)` produces on a non-zero exit. */
function execFailure(over: { code?: number | string; message?: string; stderr?: string; killed?: boolean }) {
  return Object.assign(new Error(over.message ?? "Command failed"), {
    code: over.code,
    stderr: over.stderr ?? "",
    stdout: "",
    killed: over.killed ?? false,
  });
}

/** The argv a real recipe runs: absolute paths, a tenant prefix, a filename the caller chose. */
const ARGV = [
  "-i",
  "C:\\Users\\operator\\.dpsbuddy\\media\\org_7\\tnt_42\\quarterly-board-call.mp4",
  "-f",
  "null",
  "-",
];

/** Everything a message must never contain, whatever else it says. */
function assertNothingLeaked(message: string): void {
  expect(message).not.toMatch(/[A-Za-z]:\\|\/(?:home|Users|var|tmp|opt)\//);
  expect(message).not.toContain("quarterly-board-call");
  expect(message).not.toContain("tnt_42");
  expect(message).not.toContain("-i ");
  expect(message).not.toContain("ffprobe.exe");
}

async function failWith(over: Parameters<typeof execFailure>[0], bin?: "ffmpeg" | "ffprobe"): Promise<ApiError> {
  setExecFileForTests(async () => {
    throw execFailure(over);
  });
  try {
    await runFfmpeg(ARGV, { timeoutMs: 1_000, ...(bin ? { bin } : {}) });
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("runFfmpeg resolved where it should have thrown");
}

afterEach(() => {
  setExecFileForTests(null);
});

describe("a failing ffmpeg run", () => {
  it("never hands the client the command line it ran", async () => {
    // This is the real shape: execFile's message IS the argv.
    const error = await failWith({
      code: 1,
      message: `Command failed: C:\\tools\\ffmpeg.exe ${ARGV.join(" ")}`,
      stderr: "Output file #0 does not contain any stream",
    });
    expect(error.code).toBe("ffmpeg_failed");
    assertNothingLeaked(error.message);
  });

  it("never hands the client the tail of stderr, however useful it looks", async () => {
    const error = await failWith({
      code: 1,
      stderr:
        "[mp4 @ 0000021f] moov atom not found\n" +
        "C:\\Users\\operator\\.dpsbuddy\\media\\org_7\\tnt_42\\quarterly-board-call.mp4: Invalid data found when processing input",
    });
    assertNothingLeaked(error.message);
  });

  it("says enough to act on: a stable sentence and a reason class", async () => {
    const unreadable = await failWith({ code: 1, stderr: "Invalid data found when processing input" });
    expect(unreadable.message).toBe("ffmpeg could not process that media (unreadable input)");

    const exited = await failWith({ code: 3, stderr: "Conversion failed!" });
    expect(exited.message).toBe("ffmpeg could not process that media (exit code 3)");

    const nostart = await failWith({ code: "ENOENT", message: "spawn C:\\tools\\ffmpeg.exe ENOENT" });
    expect(nostart.message).toBe("ffmpeg could not process that media (the tool could not be started)");
    assertNothingLeaked(nostart.message);

    const unknown = await failWith({ message: "something went wrong somewhere" });
    expect(unknown.message).toBe("ffmpeg could not process that media (an unknown error)");
  });

  /**
   * Meeting renders this message verbatim in the studio's error banner, so it has to read like a
   * sentence rather than a code — the one thing the coarse message must not become is
   * `ffmpeg_failed`, which is what a bare reason class would have looked like on screen.
   */
  it("stays human-readable, which is what Meeting's SSE frame shows the owner", async () => {
    const error = await failWith({ code: 1, stderr: "moov atom not found" }, "ffprobe");
    expect(error.message).toMatch(/^ffmpeg could not process that media \([a-z0-9 ]+\)$/);
    expect(error.status).toBe(400);
  });

  it("still answers cancellation and timeout with their own codes", async () => {
    const cancelled = await failWith({ code: "ABORT_ERR" });
    expect(cancelled.code).toBe("job_cancelled");

    const timedOut = await failWith({ code: 1, killed: true });
    expect(timedOut.code).toBe("ffmpeg_timeout");
    expect(timedOut.message).toBe("ffmpeg timed out");
  });
});
