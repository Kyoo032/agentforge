/**
 * The async ffmpeg probe (`resolveFfmpegAsync`, `getEditDoctorAsync`).
 *
 * Boot used to await a synchronous probe of ~270 ms (PATH walk + `ffmpeg -version`) ahead of the first
 * paint. The async twin exists so that walk runs off the critical path. These cases pin what must not
 * change with it: the verdicts (a parity table run through both probes), the per-process cache, the
 * allowlisted environment, and the "a reset means look again" rule.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTrackedChildrenForTests, trackedChildCount } from "../child-processes";
import { getEditDoctorAsync, RECHECK_MIN_INTERVAL_MS, resetDoctorRecheckThrottle } from "./doctor";
import { type BinaryStatus, resetFfmpegBinaryCache, resolveFfmpeg, resolveFfmpegAsync } from "./ffmpeg-binary";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}));

const mockedSync = vi.mocked(execFileSync);
const mockedAsync = vi.mocked(execFile);
const mockedExists = vi.mocked(existsSync);

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;
type Scenario = (file: string) => string;

const banner = (version: string): string => `ffmpeg version ${version} Copyright (c) 2000-2023 the FFmpeg developers\n`;
const isPathLookup = (file: string): boolean => /(?:^|[\\/])(?:which|where\.exe)$/i.test(file);

async function withPlatform<T>(platform: string, run: () => Promise<T> | T): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(process, "platform", original);
    }
  }
}

/** A child the registry accepts: a pid, no exit yet, and an `exit` listener slot. */
function fakeChild(pid = 4242) {
  const listeners: Array<(...args: unknown[]) => void> = [];
  return {
    pid,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
    once: (_event: "exit", listener: (...args: unknown[]) => void) => {
      listeners.push(listener);
    },
    emitExit: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/** Drive both mocks from one scenario, so the sync and async probes see the identical machine. */
function installScenario(scenario: Scenario): void {
  mockedSync.mockReset();
  mockedAsync.mockReset();
  mockedSync.mockImplementation(((file: string) => scenario(file)) as never);
  mockedAsync.mockImplementation(((file: string, _args: unknown, _options: unknown, done: ExecCallback) => {
    setImmediate(() => {
      try {
        done(null, scenario(file), "");
      } catch (error) {
        done(error as Error, "", "");
      }
    });
    return fakeChild();
  }) as never);
}

const totalProbes = (): number => mockedSync.mock.calls.length + mockedAsync.mock.calls.length;

const saved = {
  ffmpeg: process.env.AGENTFORGE_FFMPEG_PATH,
  ffprobe: process.env.AGENTFORGE_FFPROBE_PATH,
  asr: process.env.AGENTFORGE_EDIT_ASR_MODEL,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

beforeEach(() => {
  resetFfmpegBinaryCache();
  resetDoctorRecheckThrottle();
  resetTrackedChildrenForTests();
  mockedExists.mockReset();
  mockedExists.mockReturnValue(false);
  delete process.env.AGENTFORGE_FFMPEG_PATH;
  delete process.env.AGENTFORGE_FFPROBE_PATH;
  delete process.env.AGENTFORGE_EDIT_ASR_MODEL;
});

afterEach(() => {
  resetFfmpegBinaryCache();
  resetTrackedChildrenForTests();
  restore("AGENTFORGE_FFMPEG_PATH", saved.ffmpeg);
  restore("AGENTFORGE_FFPROBE_PATH", saved.ffprobe);
  restore("AGENTFORGE_EDIT_ASR_MODEL", saved.asr);
});

describe("resolveFfmpegAsync gives the verdict resolveFfmpeg gives", () => {
  type Case = {
    name: string;
    platform: string;
    env?: string;
    existing?: string[];
    scenario: Scenario;
    expected: BinaryStatus;
  };

  const notOnPath: Scenario = () => {
    throw new Error("nothing on PATH");
  };

  const cases: Case[] = [
    {
      name: "the configured path, major >= 6",
      platform: "linux",
      env: "/opt/ffmpeg/ffmpeg",
      scenario: () => banner("6.1.1"),
      expected: { found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.1.1" },
    },
    {
      name: "the configured path, older than 6",
      platform: "linux",
      env: "/opt/old/ffmpeg",
      scenario: () => banner("5.1.2"),
      expected: { found: false, path: "/opt/old/ffmpeg", version: "5.1.2", reason: "version_below_6" },
    },
    {
      name: "the configured path with no version banner",
      platform: "linux",
      env: "/opt/odd/ffmpeg",
      scenario: () => "not a banner",
      expected: { found: false, path: "/opt/odd/ffmpeg", version: null, reason: "unparsed_version" },
    },
    {
      name: "the configured path that will not run",
      platform: "linux",
      env: "/opt/gone/ffmpeg",
      scenario: notOnPath,
      expected: { found: false, path: "/opt/gone/ffmpeg", version: null, reason: "exec_failed" },
    },
    {
      name: "nothing anywhere",
      platform: "linux",
      scenario: notOnPath,
      expected: { found: false, path: null, version: null, reason: "missing" },
    },
    {
      name: "PATH on Windows, through an absolute where.exe",
      platform: "win32",
      scenario: (file) => (isPathLookup(file) ? "C:\\tools\\ffmpeg.exe\r\nD:\\other\\ffmpeg.exe\r\n" : banner("7.0")),
      expected: { found: true, path: "C:\\tools\\ffmpeg.exe", version: "7.0" },
    },
    {
      name: "the Homebrew prefix when a Finder-launched app has a bare PATH",
      platform: "darwin",
      existing: ["/opt/homebrew/bin/ffmpeg"],
      scenario: (file) => {
        if (file === "which") {
          throw new Error("ffmpeg not on PATH");
        }
        return banner("7.1");
      },
      expected: { found: true, path: "/opt/homebrew/bin/ffmpeg", version: "7.1" },
    },
    {
      name: "a broken well-known candidate, then a working one",
      platform: "darwin",
      existing: ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"],
      scenario: (file) => {
        if (file === "which" || file === "/opt/homebrew/bin/ffmpeg") {
          throw new Error("dangling symlink");
        }
        return banner("6.1");
      },
      expected: { found: true, path: "/usr/local/bin/ffmpeg", version: "6.1" },
    },
    {
      name: "a PATH ffmpeg that is too old, then a well-known one",
      platform: "darwin",
      existing: ["/opt/homebrew/bin/ffmpeg"],
      scenario: (file) => {
        if (file === "which") {
          return "/usr/bin/ffmpeg\n";
        }
        return file === "/usr/bin/ffmpeg" ? banner("4.4") : banner("7.0");
      },
      expected: { found: true, path: "/opt/homebrew/bin/ffmpeg", version: "7.0" },
    },
    {
      name: "only a too-old well-known candidate",
      platform: "darwin",
      existing: ["/opt/homebrew/bin/ffmpeg"],
      scenario: (file) => (file === "which" ? "" : banner("5.0")),
      expected: { found: false, path: "/opt/homebrew/bin/ffmpeg", version: "5.0", reason: "version_below_6" },
    },
  ];

  it.each(cases)("$name", async (testCase) => {
    const existing = new Set(testCase.existing ?? []);
    mockedExists.mockImplementation((candidate) => existing.has(String(candidate)));
    if (testCase.env) {
      process.env.AGENTFORGE_FFMPEG_PATH = testCase.env;
    }
    installScenario(testCase.scenario);

    await withPlatform(testCase.platform, async () => {
      const viaAsync = await resolveFfmpegAsync();
      expect(viaAsync).toEqual(testCase.expected);

      resetFfmpegBinaryCache();
      expect(resolveFfmpeg()).toEqual(viaAsync);
    });
  });
});

describe("the per-process cache", () => {
  it("shares one probe between two callers that arrive during the same walk", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    installScenario(() => banner("6.1.1"));

    const [first, second] = await Promise.all([resolveFfmpegAsync(), resolveFfmpegAsync()]);

    expect(first).toEqual({ found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.1.1" });
    expect(second).toBe(first);
    expect(mockedAsync).toHaveBeenCalledTimes(1);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("fills the cache the synchronous callers read, so Edit never probes again", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    installScenario(() => banner("6.1.1"));

    await resolveFfmpegAsync();
    const probesAfterBoot = totalProbes();

    expect(resolveFfmpeg()).toEqual({ found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.1.1" });
    await resolveFfmpegAsync();
    expect(totalProbes()).toBe(probesAfterBoot);
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("is filled by a synchronous probe too, and the async call then answers from it", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    installScenario(() => banner("7.0"));

    resolveFfmpeg();

    expect(await resolveFfmpegAsync()).toEqual({ found: true, path: "/opt/ffmpeg/ffmpeg", version: "7.0" });
    expect(mockedAsync).not.toHaveBeenCalled();
  });

  it("looks again when the configured path changes", async () => {
    installScenario((file) => (file === "/opt/a/ffmpeg" ? banner("6.1.1") : banner("7.2")));

    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/a/ffmpeg";
    expect(await resolveFfmpegAsync()).toEqual({ found: true, path: "/opt/a/ffmpeg", version: "6.1.1" });

    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/b/ffmpeg";
    expect(await resolveFfmpegAsync()).toEqual({ found: true, path: "/opt/b/ffmpeg", version: "7.2" });
    expect(resolveFfmpeg()).toEqual({ found: true, path: "/opt/b/ffmpeg", version: "7.2" });
  });

  it("looks again when the ffprobe path changes, since ffprobe hangs off the same configuration", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    installScenario(() => banner("6.1.1"));
    await resolveFfmpegAsync();
    const probesBefore = totalProbes();

    process.env.AGENTFORGE_FFPROBE_PATH = "/opt/ffmpeg/ffprobe";
    await resolveFfmpegAsync();

    expect(totalProbes()).toBe(probesBefore + 1);
  });

  it("does not let a probe that started before a reset write its answer back", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    const pending: ExecCallback[] = [];
    mockedAsync.mockReset();
    mockedSync.mockReset();
    mockedAsync.mockImplementation(((_file: string, _args: unknown, _options: unknown, done: ExecCallback) => {
      pending.push(done);
      return fakeChild();
    }) as never);
    mockedSync.mockReturnValue(banner("8.0") as never);

    const stale = resolveFfmpegAsync();
    resetFfmpegBinaryCache(); // "Check again" pressed while the first walk is still running
    pending[0]?.(null, banner("6.0"), "");
    expect(await stale).toEqual({ found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.0" });

    // The reset asked a new question; the old answer must not have become the cached one.
    expect(resolveFfmpeg()).toEqual({ found: true, path: "/opt/ffmpeg/ffmpeg", version: "8.0" });
    expect(mockedSync).toHaveBeenCalledTimes(1);
  });

  it("does not keep a probe that failed outright as the answer to every later call", async () => {
    installScenario(() => {
      throw new Error("nothing on PATH");
    });
    vi.spyOn(os, "homedir").mockImplementationOnce(() => {
      throw new Error("no home directory");
    });

    await expect(resolveFfmpegAsync()).rejects.toThrow("no home directory");

    // The rejected probe is forgotten, so the next call probes again instead of replaying the failure.
    expect(await resolveFfmpegAsync()).toEqual({ found: false, path: null, version: null, reason: "missing" });
    vi.mocked(os.homedir).mockRestore();
  });

  it("lets a synchronous caller probe for itself while an async probe is still running", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    const pending: ExecCallback[] = [];
    mockedAsync.mockReset();
    mockedSync.mockReset();
    mockedAsync.mockImplementation(((_file: string, _args: unknown, _options: unknown, done: ExecCallback) => {
      pending.push(done);
      return fakeChild();
    }) as never);
    mockedSync.mockReturnValue(banner("6.1.1") as never);

    const running = resolveFfmpegAsync();
    const verdict = { found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.1.1" };

    expect(resolveFfmpeg()).toEqual(verdict); // the caller that cannot wait answers on its own
    pending[0]?.(null, banner("6.1.1"), "");
    expect(await running).toEqual(verdict);
    expect(mockedAsync).toHaveBeenCalledTimes(1); // and nothing started a second async probe
  });

  it("forgets an in-flight probe on reset, so the next caller starts its own", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    const pending: ExecCallback[] = [];
    mockedAsync.mockReset();
    mockedAsync.mockImplementation(((_file: string, _args: unknown, _options: unknown, done: ExecCallback) => {
      pending.push(done);
      return fakeChild();
    }) as never);

    const first = resolveFfmpegAsync();
    resetFfmpegBinaryCache();
    const second = resolveFfmpegAsync();

    expect(pending).toHaveLength(2);
    pending[0]?.(null, banner("6.0"), "");
    pending[1]?.(null, banner("9.0"), "");
    expect((await first).version).toBe("6.0");
    expect((await second).version).toBe("9.0");
    expect(resolveFfmpeg().version).toBe("9.0");
  });
});

describe("what the async probe spawns", () => {
  it("passes the same allowlisted environment and limits as the synchronous probe", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    installScenario(() => banner("6.1.1"));

    await resolveFfmpegAsync();

    const call = mockedAsync.mock.calls[0];
    expect(call?.[0]).toBe("/opt/ffmpeg/ffmpeg");
    expect(call?.[1]).toEqual(["-version"]);
    const options = call?.[2] as { encoding: string; windowsHide: boolean; timeout: number; env: NodeJS.ProcessEnv };
    expect(options).toMatchObject({ encoding: "utf8", windowsHide: true, timeout: 10_000 });
    for (const key of Object.keys(options.env)) {
      expect(key).not.toMatch(/^(AGENTFORGE_SECRETS_KEY|OPENAI_|ANTHROPIC_|GOOGLE_|ARK_|VOLCENGINE_|FAL_)/i);
    }
  });

  it("looks PATH up through an absolute where.exe on Windows, never a bare `where`", async () => {
    installScenario((file) => (isPathLookup(file) ? "C:\\tools\\ffmpeg.exe\r\n" : banner("7.0")));

    await withPlatform("win32", () => resolveFfmpegAsync());

    const lookup = mockedAsync.mock.calls.find((call) => isPathLookup(String(call[0])));
    expect(String(lookup?.[0])).toMatch(/^[A-Za-z]:\\.*\\System32\\where\.exe$/);
    expect(lookup?.[1]).toEqual(["ffmpeg"]);
  });

  it("registers the child, so a quit that lands mid-probe signals it, and forgets it once it exits", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    const child = fakeChild(7001);
    let done: ExecCallback | undefined;
    mockedAsync.mockReset();
    mockedAsync.mockImplementation(((_file: string, _args: unknown, _options: unknown, callback: ExecCallback) => {
      done = callback;
      return child;
    }) as never);

    const probe = resolveFfmpegAsync();
    expect(trackedChildCount()).toBe(1);

    child.emitExit();
    done?.(null, banner("6.1.1"), "");
    await probe;
    expect(trackedChildCount()).toBe(0);
  });

  it("reports exec_failed when the spawn errors instead of leaving the promise hanging", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    mockedAsync.mockReset();
    mockedAsync.mockImplementation(((_file: string, _args: unknown, _options: unknown, done: ExecCallback) => {
      done(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "", "");
      return undefined;
    }) as never);

    expect(await resolveFfmpegAsync()).toEqual({
      found: false,
      path: "/opt/ffmpeg/ffmpeg",
      version: null,
      reason: "exec_failed",
    });
  });
});

describe("getEditDoctorAsync", () => {
  it("returns the doctor payload shape with the async probe's verdict", async () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    installScenario(() => banner("6.1.1"));

    expect(await getEditDoctorAsync()).toEqual({
      ffmpeg: { found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.1.1" },
      asr: { available: false, backend: null, model: null },
      fonts: [],
    });
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("adds setup guidance when ffmpeg is missing", async () => {
    installScenario(() => {
      throw new Error("missing");
    });

    const report = await withPlatform("darwin", () => getEditDoctorAsync());

    expect(report.ffmpeg).toMatchObject({ found: false, path: null, reason: "missing" });
    expect(report.ffmpeg.setup?.platform).toBe("macos");
    expect(report.ffmpeg.setup?.installCommand).toBe("brew install ffmpeg");
  });

  it("recheck drops the cached probe so a fresh install is seen, and the throttle still holds", async () => {
    let installed = false;
    installScenario((file) => {
      if (!installed) {
        throw new Error("missing");
      }
      return isPathLookup(file) ? "/usr/local/bin/ffmpeg\n" : banner("7.0");
    });

    expect((await getEditDoctorAsync({}, 10_000)).ffmpeg.found).toBe(false);
    installed = true;
    expect((await getEditDoctorAsync({}, 10_001)).ffmpeg.found).toBe(false); // cached, no recheck asked

    expect((await getEditDoctorAsync({ recheck: true }, 20_000)).ffmpeg.found).toBe(true);

    // ffmpeg goes away again. A recheck inside the throttle window is ignored, so the cached "found"
    // stands; one a full interval later probes again and sees the machine as it now is.
    installed = false;
    expect((await getEditDoctorAsync({ recheck: true }, 20_000 + RECHECK_MIN_INTERVAL_MS - 1)).ffmpeg.found).toBe(true);
    expect((await getEditDoctorAsync({ recheck: true }, 20_000 + RECHECK_MIN_INTERVAL_MS)).ffmpeg.found).toBe(false);
  });
});
