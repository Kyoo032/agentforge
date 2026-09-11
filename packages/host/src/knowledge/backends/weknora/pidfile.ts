import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { weknoraAvailable } from "./binary";

/**
 * The sidecar's pid file, and the rule for when it is safe to act on.
 *
 * A force-quit (or a crash between spawn and `before-quit`) leaves the sidecar holding our SQLite
 * file and our port. The pid file lets the next boot reap it — but a pid is reused, so acting on a
 * bare number risks killing whatever inherited it. Nothing is signalled unless the pid is *both*
 * alive and, as far as the OS will tell us, running our binary.
 */

/** Never trust a pid file's contents: it is a file on disk any process could have written. */
function parsePid(raw: string): number | null {
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}

export function writePidFile(file: string, pid: number): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${pid}\n`, "utf8");
  } catch (error) {
    console.warn(`weknora: pid file not written (${short(error)})`);
  }
}

export function clearPidFile(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // A pid file we cannot delete is stale at worst; the ownership check below is the real guard.
  }
}

export function readPidFile(file: string): number | null {
  try {
    return parsePid(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function short(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "error";
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence checks without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The executable path of a running process, or "" when it cannot be read.
 *
 * The *path* is what the ownership check needs, not a command line: a basename substring match
 * would accept any process whose arguments happen to mention the word, which is a string every
 * local process can put in its own argv.
 */
export function processExecutablePath(pid: number): string {
  try {
    if (process.platform === "win32") {
      // `tasklist` reports an image name with no directory, so it cannot answer this question.
      return execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").ExecutablePath`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 5_000 },
      );
    }
    // `comm=` is the executable path on macOS and Linux; `command=` would include the arguments.
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", timeout: 5_000 });
  } catch {
    return "";
  }
}

/** Path comparison that matches how the platform itself compares them. */
function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value.trim());
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (!left.trim() || !right.trim()) {
    return false;
  }
  return normalize(left) === normalize(right);
}

export type ReapOptions = {
  /** The binary a pid must be running to count as ours. Defaults to the resolved sidecar path. */
  expectedPath?: string | null;
  describe?: (pid: number) => string;
};

/**
 * Alive *and* running the exact binary we would have spawned. A pid the OS will not describe, or
 * one we have no expected path for, is left alone — never signalled on a guess.
 */
export function isOurSidecar(pid: number, options: ReapOptions = {}): boolean {
  if (!isAlive(pid)) {
    return false;
  }
  const expected = options.expectedPath ?? weknoraAvailable().path;
  if (!expected) {
    return false;
  }
  return samePath((options.describe ?? processExecutablePath)(pid), expected);
}

/**
 * Kill a leftover sidecar named by the pid file, if there is one, and forget the file either way.
 * Returns the pid it signalled, or null. Never throws: a boot must not fail on a stale file.
 */
export function reapStaleSidecar(file: string, options: ReapOptions = {}): number | null {
  const pid = readPidFile(file);
  if (pid === null) {
    return null;
  }
  clearPidFile(file);
  if (!isOurSidecar(pid, options)) {
    return null;
  }
  try {
    process.kill(pid, "SIGKILL");
    return pid;
  } catch (error) {
    console.warn(`weknora: leftover sidecar ${pid} not killed (${short(error)})`);
    return null;
  }
}
