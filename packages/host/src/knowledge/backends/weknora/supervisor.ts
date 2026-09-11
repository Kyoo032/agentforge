import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import type { Readable } from "node:stream";
import path from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";
import { trackChild } from "../../../child-processes";
import { BackendUnavailable } from "../../backend";
import { disableWeknoraBinary, weknoraAvailable, weknoraBinaryDir } from "./binary";
import { sidecarEnv, sidecarPaths } from "./env";
import { clearPidFile, reapStaleSidecar, writePidFile } from "./pidfile";
import { verifyPortOwner } from "./port-owner";
import { loadWeknoraSecrets } from "./secrets";

/**
 * Lifecycle of the bundled WeKnora-lite process.
 *
 * It is spawned lazily on the first knowledge call, on a loopback port we proved free in Node, with
 * an explicit environment (see env.ts) and `cwd` set to the binary's own folder — WeKnora loads
 * `migrations/sqlite/` and `config/config.yaml` from disk relative to its working directory, so
 * that path is load-bearing rather than cosmetic.
 *
 * It is stopped on idle, on `before-quit` (via `trackChild`), and reaped from a pid file at boot.
 * Nothing here retries forever: a sidecar that will not come up is reported as unavailable so the
 * registry can answer from the built-in backend instead of blocking Chat.
 */

/** One probe of `/health`. Short on purpose: this runs on the retrieval path. */
export const HEALTH_TIMEOUT_MS = 1_500;
/** Total budget for a cold start, including the SQLite migrations WeKnora runs on first boot. */
export const READY_TIMEOUT_MS = 20_000;
const PROBE_GAP_MS = 250;
/** How long a SIGTERM is given to land before SIGKILL. */
export const STOP_GRACE_MS = 5_000;
/** No knowledge call for this long and the sidecar goes away; the next call brings it back. */
export const IDLE_SHUTDOWN_MS = 15 * 60 * 1000;
/** Stderr kept for diagnostics when a start fails. Bounded: this is an untrusted child's output. */
const STDERR_KEEP = 2_000;

/** The sidecar as spawned: stdin closed, stdout and stderr piped so a failed start has a reason. */
type SidecarChild = ChildProcessByStdio<null, Readable, Readable>;

export type SidecarStatus = {
  /** Up *and* past readiness. False for the whole cold start, so nothing addresses a dead port. */
  running: boolean;
  /**
   * The readiness flag `running` is built from. Reported separately because callers that only want
   * to piggy-back on an already-warm sidecar (the outbox drain on `GET /api/v1/knowledge`) ask for
   * it by name, and "a process exists" was never the question they meant.
   */
  ready: boolean;
  pid: number | null;
  port: number | null;
  baseUrl: string | null;
  startedAt: number | null;
  /** Why the last start or stop failed, trimmed to one line. Null when nothing has gone wrong. */
  lastError: string | null;
};

/** What the backend needs from a sidecar. A test substitutes an object that never spawns anything. */
export type SidecarHandle = {
  /** Loopback base URL, starting the process if it is not up. Rejects with `BackendUnavailable`. */
  baseUrl(): Promise<string>;
  status(): SidecarStatus;
  stop(): Promise<void>;
};

export type SupervisorOptions = {
  /** Overrides binary resolution. With `args`, this is how a test spawns a fake Node sidecar. */
  binaryPath?: string;
  args?: string[];
  /** Defaults to `localDataDir()/weknora`. */
  dataDir?: string;
  /** Defaults to the binary's directory. */
  cwd?: string;
  parentEnv?: NodeJS.ProcessEnv;
  idleMs?: number;
  readyTimeoutMs?: number;
  /** Health probe, so a test can drive readiness without a real HTTP server. */
  probe?: (baseUrl: string) => Promise<boolean>;
  /** Port-ownership check, so a test can drive both verdicts without a second listener. */
  verifyOwner?: (port: number, pid: number) => Promise<{ verdict: "ok" | "mismatch" | "unknown"; owner: number | null }>;
};

export function defaultWeknoraDataDir(): string {
  return path.join(localDataDir(), "weknora");
}

/** A port the OS just handed out and immediately released. WeKnora retries if it is taken again. */
export async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        if (port > 0) {
          resolve(port);
        } else {
          reject(new Error("could not reserve a loopback port"));
        }
      });
    });
  });
}

async function probeHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function short(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

export class WeKnoraSupervisor implements SidecarHandle {
  private child: SidecarChild | null = null;
  /**
   * Set only after `/health` answered *and* the port proved to belong to our child. `attach` runs
   * long before either, so anything that reads `child`/`port` alone would call a cold start "up"
   * and hand out an address nothing is answering on yet.
   */
  private ready = false;
  /** Sticky: a hijacked port is not retried for the life of this process. */
  private hijacked = false;
  private port: number | null = null;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private stderrTail = "";
  private spawnError: string | null = null;
  private starting: Promise<string> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: SupervisorOptions = {}) {}

  status(): SidecarStatus {
    return {
      ready: this.ready,
      running: this.child !== null && this.port !== null && this.ready,
      pid: this.child?.pid ?? null,
      port: this.port,
      baseUrl: this.port === null ? null : `http://127.0.0.1:${this.port}`,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  async baseUrl(): Promise<string> {
    if (this.hijacked) {
      throw new BackendUnavailable("weknora", "port_hijacked", "WeKnora sidecar port was taken by another process");
    }
    this.touch();
    const current = this.status();
    // `running` honours readiness, so a second caller arriving mid-boot falls through to the
    // single-flight promise below instead of being handed a port nothing is listening on yet.
    if (current.running && current.baseUrl) {
      return current.baseUrl;
    }
    // One start at a time: two knowledge calls arriving together must not spawn two sidecars.
    if (!this.starting) {
      const pending = this.start();
      this.starting = pending;
      void pending.then(
        () => this.clearStarting(pending),
        () => this.clearStarting(pending),
      );
    }
    return this.starting;
  }

  private clearStarting(pending: Promise<string>): void {
    if (this.starting === pending) {
      this.starting = null;
    }
  }

  private resolveBinary(): { binaryPath: string; args: string[]; cwd: string } {
    const override = this.options.binaryPath;
    if (override) {
      return {
        binaryPath: override,
        args: this.options.args ?? [],
        cwd: this.options.cwd ?? weknoraBinaryDir(override),
      };
    }
    const found = weknoraAvailable();
    if (!found.available || !found.path) {
      throw new BackendUnavailable("weknora", found.reason ?? "not_staged");
    }
    return {
      binaryPath: found.path,
      args: this.options.args ?? [],
      cwd: this.options.cwd ?? weknoraBinaryDir(found.path),
    };
  }

  private async start(): Promise<string> {
    const dataDir = this.options.dataDir ?? defaultWeknoraDataDir();
    const paths = sidecarPaths(dataDir);
    try {
      const { binaryPath, args, cwd } = this.resolveBinary();
      mkdirSync(paths.files, { recursive: true });
      reapStaleSidecar(paths.pidFile, { expectedPath: binaryPath });
      const port = await freeLoopbackPort();
      const secrets = loadWeknoraSecrets();
      const child = spawn(binaryPath, args, {
        cwd,
        env: sidecarEnv({
          port,
          dataDir,
          aesKey: secrets.aesKey,
          jwtSecret: secrets.jwtSecret,
          parent: this.options.parentEnv,
        }),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }) as SidecarChild;
      this.attach(child, port, paths.pidFile);
      await this.waitForReady(child, `http://127.0.0.1:${port}`);
      await this.assertPortIsOurs(child, port);
      this.ready = true;
      this.startedAt = Date.now();
      this.lastError = null;
      this.touch();
      return `http://127.0.0.1:${port}`;
    } catch (error) {
      this.lastError = short(error);
      await this.stop();
      throw error instanceof BackendUnavailable
        ? error
        : new BackendUnavailable("weknora", "spawn_failed", `WeKnora sidecar did not start: ${short(error)}`);
    }
  }

  private attach(child: SidecarChild, port: number, pidFile: string): void {
    this.child = child;
    this.port = port;
    this.ready = false;
    this.stderrTail = "";
    this.spawnError = null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    // Drained, never parsed: the address comes from the port we chose, not from the child's word.
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-STDERR_KEEP);
    });
    child.once("exit", () => {
      if (this.child === child) {
        this.child = null;
        this.port = null;
        this.ready = false;
        this.startedAt = null;
      }
      clearPidFile(pidFile);
    });
    child.once("error", (error) => {
      // ENOENT / EACCES arrive here, not as an exit: without this the readiness loop would poll a
      // process that was never born for the whole 20 s budget.
      this.spawnError = short(error);
      this.lastError = this.spawnError;
    });
    trackChild(child);
    if (child.pid) {
      writePidFile(pidFile, child.pid);
    }
  }

  /**
   * Refuse to talk to a port our child does not own.
   *
   * `freeLoopbackPort` proves a port was free, releases it, and only then spawns; a local process
   * can take it in between and answer `/health` with four lines of JSON. Every call after this one
   * carries a credential — the auto-setup token, the long-lived API key, the gateway key inside the
   * model row — so the identity question has to be settled here, before the first of them.
   *
   * A tool that cannot answer (missing `lsof`, a locked-down `netstat`) is a warning, not a
   * failure: the check is defence in depth over a loopback-only channel that is already
   * authenticated, and making it fatal would turn a hardened path into an availability bug.
   */
  private async assertPortIsOurs(child: SidecarChild, port: number): Promise<void> {
    const pid = child.pid;
    if (!pid) {
      return;
    }
    const verify = this.options.verifyOwner ?? verifyPortOwner;
    const { verdict, owner } = await verify(port, pid);
    if (verdict === "unknown") {
      console.warn(`weknora: could not confirm which process owns port ${port}; proceeding on loopback only`);
      return;
    }
    if (verdict === "mismatch") {
      this.hijacked = true;
      disableWeknoraBinary("port_hijacked");
      await this.stop();
      throw new BackendUnavailable(
        "weknora",
        "port_hijacked",
        `WeKnora sidecar port ${port} is held by pid ${owner ?? "unknown"}, not the child we spawned (${pid})`,
      );
    }
  }

  private async waitForReady(child: SidecarChild, baseUrl: string): Promise<void> {
    const probe = this.options.probe ?? probeHealth;
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? READY_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (this.spawnError) {
        throw new BackendUnavailable("weknora", "spawn_failed", `WeKnora sidecar could not start: ${this.spawnError}`);
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new BackendUnavailable(
          "weknora",
          "exited",
          `WeKnora sidecar exited during startup (${child.exitCode ?? child.signalCode}): ${this.stderrTail.slice(-400)}`,
        );
      }
      if (await probe(baseUrl)) {
        return;
      }
      await sleep(PROBE_GAP_MS);
    }
    throw new BackendUnavailable(
      "weknora",
      "health_timeout",
      `WeKnora sidecar did not answer /health within ${this.options.readyTimeoutMs ?? READY_TIMEOUT_MS} ms: ${this.stderrTail.slice(-400)}`,
    );
  }

  /** SIGTERM, then SIGKILL if it is still there. Idempotent and never throws. */
  async stop(): Promise<void> {
    this.clearIdleTimer();
    const child = this.child;
    this.child = null;
    this.port = null;
    this.ready = false;
    this.startedAt = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      child.kill("SIGTERM");
    } catch {
      return;
    }
    const timedOut = await Promise.race([exited.then(() => false), sleep(STOP_GRACE_MS).then(() => true)]);
    if (timedOut) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone between the race and here.
      }
    }
  }

  /** Restart the idle countdown. Unref'd, so a pending shutdown never holds the process open. */
  private touch(): void {
    this.clearIdleTimer();
    const idleMs = this.options.idleMs ?? IDLE_SHUTDOWN_MS;
    if (idleMs <= 0) {
      return;
    }
    this.idleTimer = setTimeout(() => {
      void this.stop();
    }, idleMs);
    this.idleTimer.unref?.();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

let shared: WeKnoraSupervisor | null = null;

/** The one sidecar this host process talks to. */
export function weknoraSupervisor(): WeKnoraSupervisor {
  shared ??= new WeKnoraSupervisor();
  return shared;
}

export function sidecarStatus(): SidecarStatus {
  return shared
    ? shared.status()
    : { running: false, ready: false, pid: null, port: null, baseUrl: null, startedAt: null, lastError: null };
}

/** Test hook: drop the shared supervisor after stopping whatever it was running. */
export async function resetWeknoraSupervisorForTests(): Promise<void> {
  const current = shared;
  shared = null;
  await current?.stop();
}
