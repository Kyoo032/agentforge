/**
 * The stage runner: `check → download → verify → unpack → probe → marker`.
 *
 * Modelled on a bootstrap manifest — every stage announces `running` and then exactly one of
 * `succeeded` / `failed`, and the whole thing is idempotent: a second launch finds the component
 * already loadable, emits every stage as `skipped`, and ends in the same `ready` status as the first.
 *
 * NOTHING here decides what to download. `manifest.ts` owns every URL and hash; this file owns
 * order, atomicity and failure. Integrity is proven in memory before `unpack` is allowed to write,
 * the write goes to `<root>.tmp-<random>` and is renamed into place, and the marker is written last.
 *
 * FAIL SOFT — an install that fails is recorded and reported, never thrown at the app. Document
 * reading keeps working through `file-extract/fallback.ts`, which is why no caller of this module
 * is on a critical path.
 */
import type { JobEmitter } from "@agentforge/core/jobs";
import { resetAnydocCache } from "../file-extract/anydoc";
import { downloadPackage, verifyIntegrity } from "./download";
import { stageReporter } from "./events";
import { appendComponentLog } from "./log";
import { componentManifest, manifestBytes, platformKey, platformPackage, requiredPackages } from "./manifest";
import type { ComponentManifestEntry } from "./manifest";
import { componentModulesDir, componentRoot, hasComponentMarker, writeComponentMarker } from "./paths";
import { componentLoadsFrom, componentProbe, componentStatus } from "./status";
import { cleanStaleStaging, createStagingDir, promoteStaging, unpackPackage } from "./unpack";
import { COMPONENT_STAGES, ComponentError, asComponentFailure } from "./types";
import type { ComponentFailure, ComponentId, ComponentSource, ComponentStage, ComponentStatus } from "./types";

export type InstallOptions = {
  readonly fetchImpl?: typeof fetch;
  readonly emit?: JobEmitter;
  readonly abortSignal?: AbortSignal;
  /** Injectable so a test can drive an install on a machine that has (or lacks) the real module. */
  readonly probe?: () => ComponentSource | null;
  readonly backoffMs?: number;
  /**
   * Test seams, and only that. `handlers/components.ts` never sets either, so on every real run the
   * entry and the platform come from the frozen manifest and from `process` — never from a caller.
   */
  readonly manifest?: ComponentManifestEntry;
  readonly platform?: string;
};

/** One install per component at a time; a second caller is told `busy` rather than racing the disk. */
const inFlight = new Set<ComponentId>();
/** The last failure, so `GET /api/v1/components` can explain a `failed` state after the stream closed. */
const failures = new Map<ComponentId, ComponentFailure>();

export function isComponentInstalling(id: ComponentId): boolean {
  return inFlight.has(id);
}

export function lastComponentFailure(id: ComponentId): ComponentFailure | null {
  return failures.get(id) ?? null;
}

/** Tests only: forget the in-memory registers between cases. */
export function resetComponentInstallState(): void {
  inFlight.clear();
  failures.clear();
}

/** The status `GET /api/v1/components` answers, including anything the last install left behind. */
export function reportComponentStatus(id: ComponentId, probe?: InstallOptions["probe"]): ComponentStatus {
  return componentStatus(id, {
    probe: probe ?? componentProbe(id),
    installing: isComponentInstalling(id),
    failure: lastComponentFailure(id),
  });
}

type Run = {
  readonly id: ComponentId;
  readonly report: ReturnType<typeof stageReporter>;
  readonly probe: () => ComponentSource | null;
  readonly entry: ComponentManifestEntry;
  readonly platform: string;
  readonly options: InstallOptions;
};

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ComponentError("download_failed", "Install cancelled");
  }
}

/** Announce, run, announce the outcome. A throw is re-thrown once `failed` has been emitted. */
async function stage(run: Run, name: ComponentStage, work: () => Promise<void>): Promise<void> {
  const started = Date.now();
  run.report.phase(name, "running");
  try {
    await work();
  } catch (error) {
    run.report.phase(name, "failed", Date.now() - started);
    throw error;
  }
  run.report.phase(name, "succeeded", Date.now() - started);
}

async function downloadAll(run: Run, totalBytes: number): Promise<Map<string, Buffer>> {
  const packages = requiredPackages(run.entry, run.platform);
  const tarballs = new Map<string, Buffer>();
  let received = 0;
  await stage(run, "download", async () => {
    for (const pkg of packages) {
      checkAborted(run.options.abortSignal);
      const bytes = await downloadPackage(pkg, {
        fetchImpl: run.options.fetchImpl,
        abortSignal: run.options.abortSignal,
        backoffMs: run.options.backoffMs,
        onBytes: (count) => {
          received += count;
          run.report.progress("download", received, totalBytes, pkg.name);
        },
      });
      tarballs.set(pkg.name, bytes);
    }
  });
  return tarballs;
}

/** Everything after `check`. Ordered exactly as the contract lists the stages. */
async function runStages(run: Run, root: string): Promise<void> {
  const packages = requiredPackages(run.entry, run.platform);
  const tarballs = await downloadAll(run, manifestBytes(run.entry, run.platform));

  // The download already proved each digest (a bad body is re-fetched there). This stage re-asserts
  // it over the retained buffers, so "verified before anything is written" is a step the contract
  // can point at and nothing can reach `unpack` on bytes that were never checked.
  await stage(run, "verify", async () => {
    for (const pkg of packages) {
      verifyIntegrity(tarballs.get(pkg.name) as Buffer, pkg.integrity, pkg.name);
    }
  });

  await stage(run, "unpack", async () => {
    cleanStaleStaging(root);
    const staging = createStagingDir(root);
    try {
      for (const pkg of packages) {
        unpackPackage(componentModulesDir(staging), pkg, tarballs.get(pkg.name) as Buffer);
      }
      promoteStaging(staging, root);
    } catch (error) {
      cleanStaleStaging(root);
      throw error;
    }
  });

  await stage(run, "probe", async () => {
    // The memoised failure from before the install would otherwise outlive the files that fix it.
    resetAnydocCache();
    const loads = run.options.probe ? run.probe() !== null : componentLoadsFrom(run.id, root);
    if (!loads) {
      throw new ComponentError("probe_failed", `${run.id} was unpacked but still does not load`);
    }
  });

  await stage(run, "marker", async () => {
    writeComponentMarker(run.id, run.entry.version, root, run.platform);
  });
}

function statusOf(run: Run, probe: () => ComponentSource | null): ComponentStatus {
  return componentStatus(run.id, { probe, manifest: run.entry, platform: run.platform });
}

async function install(run: Run): Promise<ComponentStatus> {
  const present = run.probe();
  if (present) {
    // Idempotent second launch: nothing to do, and the contract says so stage by stage.
    for (const name of COMPONENT_STAGES) {
      run.report.phase(name, "skipped");
    }
    return statusOf(run, () => present);
  }
  const root = componentRoot(run.id, run.entry.version);
  if (!platformPackage(run.entry, run.platform)) {
    run.report.phase("check", "running");
    run.report.phase("check", "failed");
    throw new ComponentError("unsupported_platform", `${run.id} has no prebuilt binary for ${run.platform}`);
  }
  await stage(run, "check", async () => {
    cleanStaleStaging(root);
  });

  await runStages(run, root);
  if (!hasComponentMarker(run.id, run.entry.version, root)) {
    throw new ComponentError("unpack_failed", `${run.id} finished without a completion marker`);
  }
  return statusOf(run, run.probe);
}

/**
 * Install `id` if it is not already there, streaming every stage through `options.emit`.
 * Resolves with the final status; rejects with a `ComponentError` whose `code` is one of the
 * contract codes, which `jobErrorFromUnknown` carries straight into `job.error`.
 */
export async function installComponent(id: ComponentId, options: InstallOptions = {}): Promise<ComponentStatus> {
  if (inFlight.has(id)) {
    throw new ComponentError("busy", `${id} is already being installed`);
  }
  inFlight.add(id);
  const run: Run = {
    id,
    report: stageReporter(id, options.emit),
    probe: options.probe ?? componentProbe(id),
    entry: options.manifest ?? componentManifest(id),
    platform: options.platform ?? platformKey(),
    options,
  };
  appendComponentLog(`${id} install requested`);
  try {
    const status = await install(run);
    failures.delete(id);
    appendComponentLog(`${id} install ${status.state} (${status.source ?? "none"})`);
    return status;
  } catch (error) {
    const failure = asComponentFailure(error, "unpack_failed");
    failures.set(id, failure);
    appendComponentLog(`${id} install failed ${failure.code}: ${failure.message}`);
    throw error instanceof ComponentError ? error : new ComponentError(failure.code, failure.message);
  } finally {
    inFlight.delete(id);
  }
}
