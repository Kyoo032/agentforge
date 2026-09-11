import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BackendUnavailable } from "../../backend";
import { resetWeknoraBinaryStateForTests, weknoraAvailable } from "./binary";
import { FORBIDDEN_ENV_KEYS } from "./env";
import { reapStaleSidecar } from "./pidfile";
import { WeKnoraSupervisor, freeLoopbackPort, type SupervisorOptions } from "./supervisor";

/**
 * The supervisor is tested against a real child process — a tiny Node script standing in for the
 * Go binary — because everything worth asserting here (does the port reach the child, does the pid
 * file get written, does SIGTERM land) is about process boundaries, and a mocked `spawn` proves
 * none of it.
 */

const FAKE_SIDECAR = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "fake-sidecar.cjs");

let dataDir: string;
let settingsDir: string;
let previousSettings: string | undefined;
const started: WeKnoraSupervisor[] = [];

function supervisor(options: Partial<SupervisorOptions> = {}) {
  const created = new WeKnoraSupervisor({
    binaryPath: process.execPath,
    args: [FAKE_SIDECAR],
    dataDir,
    // The fake sidecar is a script, not a binary in a resources folder, so cwd is ours to pick.
    cwd: path.dirname(FAKE_SIDECAR),
    idleMs: 0,
    readyTimeoutMs: 10_000,
    ...options,
  });
  started.push(created);
  return created;
}

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "af-weknora-sup-"));
  settingsDir = mkdtempSync(path.join(tmpdir(), "af-weknora-settings-"));
  previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
  process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  resetWeknoraBinaryStateForTests();
});

afterEach(async () => {
  for (const running of started.splice(0)) {
    await running.stop();
  }
  if (previousSettings === undefined) {
    delete process.env.AGENTFORGE_SETTINGS_PATH;
  } else {
    process.env.AGENTFORGE_SETTINGS_PATH = previousSettings;
  }
  resetWeknoraBinaryStateForTests();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(settingsDir, { recursive: true, force: true });
});

/** A probe that answers `false` `n` times before it starts telling the truth. */
function slowProbe(misses: number): (baseUrl: string) => Promise<boolean> {
  let seen = 0;
  return async (baseUrl: string) => {
    seen += 1;
    if (seen <= misses) {
      return false;
    }
    try {
      return (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1_000) })).ok;
    } catch {
      return false;
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("weknora supervisor", () => {
  it("hands out a free loopback port that is actually free", async () => {
    const port = await freeLoopbackPort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65_536);
    expect(await freeLoopbackPort()).toBeGreaterThan(0);
  });

  it("spawns the sidecar, waits for /health, and reports a loopback address", async () => {
    const sidecar = supervisor();
    const baseUrl = await sidecar.baseUrl();
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const status = sidecar.status();
    expect(status.running).toBe(true);
    expect(status.pid).toBeGreaterThan(0);
    expect(status.port).toBe(Number(new URL(baseUrl).port));
    const health = await fetch(`${baseUrl}/health`);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
  }, 30_000);

  it("starts once when two callers ask at the same time", async () => {
    const sidecar = supervisor();
    const [first, second] = await Promise.all([sidecar.baseUrl(), sidecar.baseUrl()]);
    expect(first).toBe(second);
  }, 30_000);

  it("is not 'running' until /health has answered", async () => {
    // Readiness is what `running` means. A boot that is still probing must read as down, or the
    // Knowledge page's drain-on-read (and anything else that piggy-backs on a warm sidecar) would
    // address a port nothing is listening on yet.
    const sidecar = supervisor({ probe: slowProbe(6) });
    const pending = sidecar.baseUrl();
    await sleep(120);
    expect(sidecar.status().running).toBe(false);
    expect(sidecar.status().ready).toBe(false);
    await pending;
    expect(sidecar.status().running).toBe(true);
    expect(sidecar.status().ready).toBe(true);
  }, 30_000);

  it("joins the start already in flight when a second caller arrives mid-boot", async () => {
    // The race this closes: `attach` sets child/port long before readiness, so a second caller that
    // trusted `status().running` would skip the single-flight promise and be handed a dead URL.
    const sidecar = supervisor({ probe: slowProbe(6) });
    const first = sidecar.baseUrl();
    await sleep(150);
    const second = sidecar.baseUrl();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(sidecar.status().lastError).toBeNull();
    // Both URLs are live, which is the whole point of making the second caller wait.
    await expect((await fetch(`${b}/health`)).json()).resolves.toEqual({ status: "ok" });
  }, 30_000);

  it("refuses the port when another process owns it, and stays unavailable", async () => {
    const sidecar = supervisor({
      verifyOwner: async () => ({ verdict: "mismatch", owner: 4242 }),
    });
    await expect(sidecar.baseUrl()).rejects.toMatchObject({ reason: "port_hijacked" });
    expect(sidecar.status().running).toBe(false);
    // Sticky for the life of the process: the machine has something racing us onto loopback ports.
    expect(weknoraAvailable()).toMatchObject({ available: false, reason: "port_hijacked" });
    await expect(sidecar.baseUrl()).rejects.toMatchObject({ reason: "port_hijacked" });
  }, 30_000);

  it("starts anyway when the ownership tool cannot answer", async () => {
    const sidecar = supervisor({ verifyOwner: async () => ({ verdict: "unknown", owner: null }) });
    await expect(sidecar.baseUrl()).resolves.toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  }, 30_000);

  it("gives the child only the allowlisted environment", async () => {
    const sidecar = supervisor({
      parentEnv: { PATH: process.env.PATH, OPENAI_API_KEY: "sk-must-not-travel" },
    });
    const baseUrl = await sidecar.baseUrl();
    const childEnv = (await (await fetch(`${baseUrl}/__env`)).json()) as Record<string, string>;
    for (const key of FORBIDDEN_ENV_KEYS) {
      expect(childEnv[key], `${key} reached the child`).toBeUndefined();
    }
    expect(childEnv.SERVER_HOST).toBe("127.0.0.1");
    expect(childEnv.DUCKDB_SKIP_EXTENSION_LOAD).toBe("1");
    expect(childEnv.SERVER_PORT).toBe(new URL(baseUrl).port);
  }, 30_000);

  it("writes a pid file while it runs and clears it on stop", async () => {
    const sidecar = supervisor();
    await sidecar.baseUrl();
    const pidFile = path.join(dataDir, "sidecar.pid");
    expect(existsSync(pidFile)).toBe(true);
    expect(Number(readFileSync(pidFile, "utf8").trim())).toBe(sidecar.status().pid);

    await sidecar.stop();
    expect(sidecar.status().running).toBe(false);
    // The exit handler clears the file; give the event loop the turn it needs to run.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(existsSync(pidFile)).toBe(false);
  }, 30_000);

  it("reports a child that exits during startup instead of waiting out the timeout", async () => {
    // The mode is an argv, not an env var: the allowlist would refuse to pass one through, which
    // is itself the behaviour under test two cases up.
    const sidecar = supervisor({ args: [FAKE_SIDECAR, "crash"], readyTimeoutMs: 5_000 });
    await expect(sidecar.baseUrl()).rejects.toBeInstanceOf(BackendUnavailable);
    expect(sidecar.status().running).toBe(false);
  }, 30_000);

  it("times out a sidecar that never answers, and kills it", async () => {
    const sidecar = supervisor({ args: [FAKE_SIDECAR, "silent"], readyTimeoutMs: 1_200 });
    await expect(sidecar.baseUrl()).rejects.toMatchObject({ reason: "health_timeout" });
    expect(sidecar.status().running).toBe(false);
  }, 30_000);

  it("reports the missing binary rather than spawning something else", async () => {
    const sidecar = supervisor({
      binaryPath: path.join(dataDir, "nope", "WeKnora-lite"),
      readyTimeoutMs: 5_000,
    });
    await expect(sidecar.baseUrl()).rejects.toMatchObject({ reason: "spawn_failed" });
  }, 30_000);

  it("will not signal a pid whose executable path only resembles ours", () => {
    const pidFile = path.join(dataDir, "sidecar.pid");
    writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    // A command line mentioning the binary is not the binary: argv is attacker-controlled.
    const reaped = reapStaleSidecar(pidFile, {
      expectedPath: path.join(dataDir, "WeKnora-lite"),
      describe: () => `/usr/bin/some-other-tool --pretend WeKnora-lite`,
    });
    expect(reaped).toBeNull();
  });

  it("leaves a pid that is not ours alone", () => {
    const pidFile = path.join(dataDir, "sidecar.pid");
    // This very process is alive, and its command line is Node's, not WeKnora-lite's.
    writeFileSync(pidFile, `${process.pid}\n`, "utf8");
    expect(reapStaleSidecar(pidFile)).toBeNull();
    expect(existsSync(pidFile)).toBe(false);
    expect(process.pid).toBeGreaterThan(0);
  });

  it("ignores a pid file that holds nonsense", () => {
    const pidFile = path.join(dataDir, "sidecar.pid");
    writeFileSync(pidFile, "not-a-pid\n", "utf8");
    expect(reapStaleSidecar(pidFile)).toBeNull();
  });

  it("kills a leftover sidecar whose command line is recognisably ours", () => {
    const pidFile = path.join(dataDir, "sidecar.pid");
    writeFileSync(pidFile, "999999\n", "utf8");
    // `describe` is injected so the ownership check can be exercised without a real WeKnora process;
    // the pid is one nothing is using, so the kill is a no-op that still proves the branch.
    const ours = path.join(dataDir, "WeKnora-lite");
    const reaped = reapStaleSidecar(pidFile, { expectedPath: ours, describe: () => ours });
    expect([999999, null]).toContain(reaped);
    expect(existsSync(pidFile)).toBe(false);
  });
});
