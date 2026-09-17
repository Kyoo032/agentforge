/**
 * The stage runner, driven end to end against a fake registry: real gzip, real ustar, real sha512,
 * real files in a throwaway data dir — only the socket and the pinned hashes are replaced.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@agentforge/core/jobs";

// Isolation: everything this subsystem writes hangs off the data dir, so point it at a temp folder
// before any module reads `localDataDir()`.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-components-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SETTINGS_PATH;

const { componentManifest } = await import("./manifest");
const { componentMarkerPath, componentPackageDir, componentRoot, componentVersionsDir } = await import("./paths");
const { installComponent, lastComponentFailure, reportComponentStatus, resetComponentInstallState } = await import(
  "./install"
);
const { componentsLogPath } = await import("./log");
const { ComponentError } = await import("./types");
type ComponentSource = import("./types").ComponentSource;

const REAL = componentManifest("anydoc");
const STAGES = ["check", "download", "verify", "unpack", "probe", "marker"] as const;
const PLATFORM = "test-arch";
const BLOCK = 512;

function tarHeader(name: string, size: number, mode = 0o644): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  block.write(name.slice(0, 99), 0, "ascii");
  block.write(mode.toString(8).padStart(7, "0"), 100, "ascii");
  block.write("0000000", 108, "ascii");
  block.write("0000000", 116, "ascii");
  block.write(size.toString(8).padStart(11, "0"), 124, "ascii");
  block.write("00000000000", 136, "ascii");
  block.write("0", 156, "ascii");
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  block.write(" ".repeat(8), 148, "ascii");
  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

function tarball(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body, "utf8");
    const pad = data.byteLength % BLOCK === 0 ? 0 : BLOCK - (data.byteLength % BLOCK);
    parts.push(tarHeader(`package/${name}`, data.byteLength), data, Buffer.alloc(pad, 0));
  }
  parts.push(Buffer.alloc(BLOCK * 2, 0));
  return gzipSync(Buffer.concat(parts));
}

function sri(bytes: Buffer): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

const MAIN_TGZ = tarball({ "index.js": "module.exports = { ok: true };\n", "package.json": '{"name":"anydoc"}\n' });
const NATIVE_TGZ = tarball({ "anydoc.node": "NOT REALLY A BINARY\n", "package.json": '{"name":"native"}\n' });
const NATIVE_NAME = "@firecrawl/anydoc-test-arch";

/** The real manifest entry, pinned to the tarballs this file builds, for one invented platform. */
const MANIFEST = {
  ...REAL,
  main: { ...REAL.main, integrity: sri(MAIN_TGZ), unpackedBytes: 60_000 },
  platforms: {
    [PLATFORM]: {
      name: NATIVE_NAME,
      tarball: `https://registry.npmjs.org/${NATIVE_NAME}/-/anydoc-test-arch-${REAL.version}.tgz`,
      integrity: sri(NATIVE_TGZ),
      unpackedBytes: 60_000,
    },
  },
};

const TOTAL_BYTES = MANIFEST.main.unpackedBytes + MANIFEST.platforms[PLATFORM].unpackedBytes;

function registryFetch(main: Buffer = MAIN_TGZ, native: Buffer = NATIVE_TGZ): typeof fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0]) =>
    String(input) === MANIFEST.main.tarball
      ? new Response(main, { status: 200 })
      : new Response(native, { status: 200 }),
  ) as never;
}

function calls(fetchImpl: typeof fetch): unknown[][] {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
}

const ROOT = () => componentRoot("anydoc", REAL.version);

/** A probe that only says "downloaded" once the unpacked main package is actually on disk. */
function diskProbe(): () => ComponentSource | null {
  return () => (existsSync(componentPackageDir(ROOT(), REAL.main.name)) ? "downloaded" : null);
}

function collector() {
  const events: JobEvent[] = [];
  return { events, emit: (event: JobEvent) => events.push(event) };
}

function phases(events: JobEvent[]): string[] {
  return events
    .filter((event): event is Extract<JobEvent, { type: "job.phase" }> => event.type === "job.phase")
    .map((event) => `${event.phase}:${event.state}`);
}

function run(extra: Record<string, unknown> = {}) {
  return installComponent("anydoc", {
    manifest: MANIFEST,
    platform: PLATFORM,
    probe: diskProbe(),
    backoffMs: 0,
    ...extra,
  });
}

async function failureOf(work: Promise<unknown>) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ComponentError);
  return error as InstanceType<typeof ComponentError>;
}

beforeEach(() => {
  resetComponentInstallState();
  rmSync(componentVersionsDir("anydoc"), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("installComponent", () => {
  it("walks every stage in order and ends ready from the download", async () => {
    const { events, emit } = collector();
    const fetchImpl = registryFetch();
    const status = await run({ fetchImpl, emit });

    expect(phases(events)).toEqual(STAGES.flatMap((stage) => [`${stage}:running`, `${stage}:succeeded`]));
    expect(status).toEqual({
      id: "anydoc",
      version: REAL.version,
      state: "ready",
      source: "downloaded",
      auto: false,
      bytes: TOTAL_BYTES,
    });
    expect(calls(fetchImpl)).toHaveLength(2);
  });

  it("writes both packages and the completion marker under the versioned root", async () => {
    await run({ fetchImpl: registryFetch() });
    expect(readFileSync(join(componentPackageDir(ROOT(), REAL.main.name), "index.js"), "utf8")).toContain("ok: true");
    expect(existsSync(join(componentPackageDir(ROOT(), NATIVE_NAME), "anydoc.node"))).toBe(true);
    expect(JSON.parse(readFileSync(componentMarkerPath(ROOT()), "utf8"))).toMatchObject({
      schemaVersion: 1,
      id: "anydoc",
      version: REAL.version,
      platform: PLATFORM,
    });
  });

  it("reports download progress as cumulative bytes against the manifest total", async () => {
    const { events, emit } = collector();
    await run({ fetchImpl: registryFetch(), emit });
    const steps = events.filter((event): event is Extract<JobEvent, { type: "job.step" }> => event.type === "job.step");
    expect(steps.map((step) => step.phase)).toEqual(["download", "download"]);
    expect(steps.map((step) => step.current)).toEqual([
      MAIN_TGZ.byteLength,
      MAIN_TGZ.byteLength + NATIVE_TGZ.byteLength,
    ]);
    expect(steps.every((step) => step.total === TOTAL_BYTES)).toBe(true);
  });

  it("is idempotent: a second run skips every stage and never fetches", async () => {
    await run({ fetchImpl: registryFetch() });
    const { events, emit } = collector();
    const second = registryFetch();
    const status = await run({ fetchImpl: second, emit });

    expect(phases(events)).toEqual(STAGES.map((stage) => `${stage}:skipped`));
    expect(status.state).toBe("ready");
    expect(calls(second)).toHaveLength(0);
  });

  it("skips everything and reports the bundled source when the module already loads", async () => {
    const { events, emit } = collector();
    const fetchImpl = registryFetch();
    const status = await run({ fetchImpl, emit, probe: () => "bundled" });
    expect(phases(events)).toEqual(STAGES.map((stage) => `${stage}:skipped`));
    expect(status).toMatchObject({ state: "ready", source: "bundled", bytes: 0 });
    expect(calls(fetchImpl)).toHaveLength(0);
  });

  it("answers busy while an install is already in flight", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      await gate;
      return new Response(String(input) === MANIFEST.main.tarball ? MAIN_TGZ : NATIVE_TGZ, { status: 200 });
    }) as never;

    const first = run({ fetchImpl: slow });
    const busy = await failureOf(run({ fetchImpl: registryFetch() }));
    expect(busy.code).toBe("busy");
    expect(busy.status).toBe(409);
    release();
    await first;
  });

  it("puts nothing in the final directory when integrity fails, and reports integrity_mismatch", async () => {
    const { events, emit } = collector();
    const error = await failureOf(run({ fetchImpl: registryFetch(tarball({ "evil.js": "pwned" })), emit }));

    expect(error.code).toBe("integrity_mismatch");
    expect(phases(events)).toContain("download:failed");
    expect(phases(events)).not.toContain("unpack:running");
    expect(existsSync(ROOT())).toBe(false);
    expect(lastComponentFailure("anydoc")?.code).toBe("integrity_mismatch");
    expect(reportComponentStatus("anydoc", diskProbe())).toMatchObject({ state: "failed" });
  });

  it("fails the probe stage when the files land but nothing loads", async () => {
    const { events, emit } = collector();
    const error = await failureOf(run({ fetchImpl: registryFetch(), emit, probe: () => null }));
    expect(error.code).toBe("probe_failed");
    expect(phases(events)).toContain("probe:failed");
    // The marker is written last, so a component that does not load is never marked complete.
    expect(existsSync(componentMarkerPath(ROOT()))).toBe(false);
  });

  it("refuses a platform the manifest has no prebuilt for, without fetching", async () => {
    const fetchImpl = registryFetch();
    const { events, emit } = collector();
    const error = await failureOf(run({ fetchImpl, emit, platform: "sunos-sparc", probe: () => null }));
    expect(error.code).toBe("unsupported_platform");
    expect(phases(events)).toEqual(["check:running", "check:failed"]);
    expect(calls(fetchImpl)).toHaveLength(0);
  });

  it("sweeps a staging directory left behind by an interrupted run", async () => {
    const stale = `${ROOT()}.tmp-abandoned`;
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "half.bin"), "x");

    await run({ fetchImpl: registryFetch() });
    expect(existsSync(stale)).toBe(false);
    expect(readdirSync(componentVersionsDir("anydoc")).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("appends every stage transition to logs/components.log and never logs a URL", async () => {
    await run({ fetchImpl: registryFetch() });
    const log = readFileSync(componentsLogPath(), "utf8");
    for (const stage of STAGES) {
      expect(log).toContain(`anydoc ${stage} succeeded`);
    }
    expect(log).not.toContain("https://");
  });
});
