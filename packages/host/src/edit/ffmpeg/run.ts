import { execFile as execFileCb, type ExecFileException } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import { ApiError } from "@agentforge/core";
import { trackChild, type TrackableChild } from "../../child-processes";
import { ffmpegLimiter, withLimit, type Limiter } from "../../concurrency";
import { log } from "../../log";
import { resolveFfmpeg, resolveFfprobe } from "../ffmpeg-binary";
import { minimalEnv } from "./env";

const defaultExecFile = promisify(execFileCb);

export type ExecFileFn = (
  file: string,
  args: readonly string[] | string[] | undefined,
  options: {
    timeout?: number;
    windowsHide?: boolean;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    encoding?: BufferEncoding | "buffer";
    maxBuffer?: number;
  },
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export type FfmpegProgress = { outTimeUs?: number; progress?: number };

export type RunFfmpegOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegProgress) => void;
  bin?: "ffmpeg" | "ffprobe";
  outputPath?: string;
};

// Re-exported so the existing `./ffmpeg/run` import path keeps working for callers and tests.
export { minimalEnv };

let execFileImpl: ExecFileFn = defaultExecFile as ExecFileFn;
/**
 * Whether `execFileImpl` above is a test's stub rather than the real `execFile`.
 *
 * `spawnFfmpeg` refuses up front when ffmpeg or ffprobe is not installed, which is right for the
 * app and wrong for a test that has already replaced the thing that would spawn it: nothing is
 * going to be executed, so the machine's PATH is not this test's business. Without this, every
 * suite built on `setExecFileForTests` passed or failed on whether the person running it happened
 * to have ffmpeg — `src/edit/import-ipc.test.ts` failed on any runner without it, which is every
 * CI runner, which is why `.github/workflows/ci.yml` could not have been added while it stood.
 */
let execFileIsStubbed = false;

export function setExecFileForTests(next: ExecFileFn | null): void {
  execFileImpl = next ?? (defaultExecFile as ExecFileFn);
  execFileIsStubbed = next !== null;
}

let limiterImpl: Limiter | null = null;

/**
 * Test seam for the hosted cap. The global limiter is chosen once, at module load, from the
 * environment this process booted with; a test that wants to see the capped behaviour hands one in
 * here instead of flipping `AGENTFORGE_SERVER` under every other suite in the file.
 */
export function setFfmpegLimiterForTests(next: Limiter | null): void {
  limiterImpl = next;
}

/** How much of a failing binary's stderr is worth carrying into the SERVER LOG. Never the client. */
const FAILURE_DETAIL_CHARS = 300;

/**
 * `execFile` refuses a fractional or non-finite timeout with `ERR_OUT_OF_RANGE` and spawns nothing,
 * so a recipe that derives its budget from a probed duration (`2 * 65.556063 * 1000 + 30_000`) used
 * to fail before ffmpeg was ever started. Rounding up here rather than at each call site means a
 * new recipe cannot reintroduce it. See `./run-timeout.test.ts`.
 */
function wholeMilliseconds(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.max(1, Math.ceil(timeoutMs)) : 0;
}

/**
 * Everything worth knowing about a failed run, FOR THE SERVER LOG ONLY.
 *
 * `execFile`'s own `message` is the full command line — the absolute path of the binary and every
 * argument, which for this app means the absolute path of a tenant's media inside the data dir —
 * and the stderr tail is whatever ffmpeg chose to print, which routinely repeats those paths. All
 * of it used to be concatenated into the `ApiError` message, which reaches the browser through
 * `jsonError` and, for Meeting, through an SSE `job.error` frame. That is the server's filesystem
 * layout and another tenant's storage prefix handed to whoever provoked the error.
 *
 * It goes through `log`, which redacts secrets and is the only place it belongs.
 */
function failureDetail(error: ExecFileException & { stderr?: string }): string {
  const stderr = String(error.stderr ?? "")
    .trim()
    .slice(-FAILURE_DETAIL_CHARS);
  return [error.code === undefined ? "" : `exit ${error.code}`, error.message?.trim(), stderr]
    .filter((part) => Boolean(part))
    .join(" — ");
}

/** ffmpeg's own words for "this file is not something I can read". Matched, never forwarded. */
const UNREADABLE_INPUT = /invalid data found|moov atom not found|end of file|invalid argument/i;

/** ...and for "this build has no codec for that", which is a deployment problem, not a bad file. */
const UNSUPPORTED_CODEC = /unknown (?:encoder|decoder|format)|could not find codec|codec .*not found/i;

/** Node's own refusals, raised before anything is spawned. A bug here, never the caller's file. */
const BAD_RUN_REQUEST = new Set(["ERR_OUT_OF_RANGE", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_VALUE"]);

/**
 * What to tell the caller: one of a handful of fixed phrases, chosen from the failure rather than
 * copied out of it.
 *
 * A reason class is enough to act on — "unreadable input" means try another file, "an unsupported
 * codec" and "exit code 1" mean tell the operator — and it cannot leak a path, an argument or a
 * tenant's filename, because no part of it comes from the process's own text.
 * `run-failure-detail.test.ts` holds that line.
 */
function failureReason(error: ExecFileException & { stderr?: string }): string {
  const stderr = String(error.stderr ?? "");
  if (error.code === "ENOENT") {
    return "the tool could not be started";
  }
  if (typeof error.code === "string" && BAD_RUN_REQUEST.has(error.code)) {
    return "an invalid run request";
  }
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return "too much output";
  }
  if (UNSUPPORTED_CODEC.test(stderr)) {
    return "an unsupported codec";
  }
  if (UNREADABLE_INPUT.test(stderr)) {
    return "unreadable input";
  }
  if (typeof error.code === "number") {
    return `exit code ${error.code}`;
  }
  return "an unknown error";
}

function parseProgress(chunk: string): FfmpegProgress {
  const outTime = chunk.match(/out_time_us=(\d+)/);
  const ratio = chunk.match(/progress=(\w+)/);
  return {
    ...(outTime ? { outTimeUs: Number(outTime[1]) } : {}),
    ...(ratio ? { progress: ratio[1] === "end" ? 1 : undefined } : {}),
  };
}

/**
 * Runs one ffmpeg / ffprobe under the global child cap (concurrency.ts). The cap sits outside the
 * recipe: a hosted machine serving several tenants encodes `AGENTFORGE_MAX_FFMPEG` clips at a time
 * and makes the rest wait, instead of spawning one encoder per request.
 *
 * On a desk the limiter is unbounded, so this is the same straight call through to `spawnFfmpeg` it
 * has always been: no cap, no queue, and the child is spawned and tracked before this returns.
 */
export function runFfmpeg(argv: string[], options: RunFfmpegOptions): Promise<{ stdout: string; stderr: string }> {
  return withLimit(limiterImpl ?? ffmpegLimiter, () => spawnFfmpeg(argv, options), options.signal);
}

async function spawnFfmpeg(argv: string[], options: RunFfmpegOptions): Promise<{ stdout: string; stderr: string }> {
  const resolved = options.bin === "ffprobe" ? resolveFfprobe() : resolveFfmpeg();
  if ((!resolved.found || !resolved.path) && !execFileIsStubbed) {
    throw new ApiError("ffmpeg_missing", "ffmpeg is not available on this machine", 400);
  }
  // Only ever reached with a stub in place, per the flag's comment; the stub ignores it.
  const binary = resolved.path ?? (options.bin === "ffprobe" ? "ffprobe" : "ffmpeg");
  const args = [...argv];
  if (options.bin !== "ffprobe" && options.onProgress && !args.includes("-progress")) {
    args.push("-progress", "pipe:1", "-nostats");
  }
  try {
    const pending = execFileImpl(binary, args, {
      timeout: wholeMilliseconds(options.timeoutMs),
      windowsHide: true,
      env: minimalEnv(),
      signal: options.signal,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    // util.promisify(execFile) attaches the ChildProcess as `child`; register it so the shell can
    // signal it on quit (macOS / Linux have no process-tree kill, see child-processes.ts).
    const child = (pending as { child?: TrackableChild }).child;
    if (child) {
      trackChild(child);
    }
    const result = await pending;
    const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
    const stderr = typeof result.stderr === "string" ? result.stderr : result.stderr.toString("utf8");
    if (options.onProgress) {
      options.onProgress(parseProgress(stdout));
    }
    return { stdout, stderr };
  } catch (error) {
    if (options.outputPath) {
      try {
        await unlink(options.outputPath);
      } catch {
        // partial may not exist
      }
    }
    const err = error as ExecFileException & { stdout?: string; stderr?: string };
    if (err.code === "ABORT_ERR" || options.signal?.aborted) {
      throw new ApiError("job_cancelled", "ffmpeg cancelled", 400);
    }
    if (typeof err.code === "number" && err.killed) {
      throw new ApiError("ffmpeg_timeout", "ffmpeg timed out", 400);
    }
    // Two audiences, two messages. The operator gets the argv and the stderr, redacted, in the
    // log; the caller gets a stable sentence and a reason class with no path in it.
    const reason = failureReason(err);
    log.warn("ffmpeg_failed", { bin: options.bin ?? "ffmpeg", reason, detail: failureDetail(err) });
    throw new ApiError("ffmpeg_failed", `ffmpeg could not process that media (${reason})`, 400);
  }
}
