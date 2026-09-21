/**
 * Phase 7 — components on a hosted server.
 *
 * Three questions, and they are the whole phase: what a server image has to carry, where a server
 * may load a component FROM, and what an operator is told when one is missing. The install route's
 * 403 is asserted next door in `../handlers/components.test.ts`; this file is about the half that
 * decides whether a fresh container is actually equipped.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-components-server-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SETTINGS_PATH;

const { componentManifest, platformPackage } = await import("./manifest");
const { COMPONENTS_DIR_ENV, componentsRootDir, downloadedComponentsAllowed, managedComponentsRoot } = await import(
  "./paths"
);
const { SERVER_COMPONENT_IDS, serverComponentReport } = await import("./server");
const { COMPONENT_IDS } = await import("./types");
type ComponentSource = import("./types").ComponentSource;
type ComponentId = import("./types").ComponentId;

/** The platform key every hosted image runs on: the Dockerfile's base is Debian on x64. */
const IMAGE_PLATFORM = "linux-x64";

const DESK = Object.freeze({});
const SERVER = Object.freeze({ AGENTFORGE_SERVER: "1", AGENTFORGE_DATA_DIR: dataDir });

function withEnv(extra: Record<string, string>): Record<string, string> {
  return { AGENTFORGE_DATA_DIR: dataDir, ...extra };
}

afterEach(() => {
  delete process.env[COMPONENTS_DIR_ENV];
  delete process.env.AGENTFORGE_SERVER;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("what a server image must carry", () => {
  it("requires every component in the manifest, so a new one cannot be forgotten", () => {
    expect([...SERVER_COMPONENT_IDS].sort()).toEqual([...COMPONENT_IDS].sort());
  });

  it("has a prebuilt for the image's own platform for each of them", () => {
    // Without this the build-time check would fail the image for a reason nobody could fix from
    // the Dockerfile: the manifest simply has no binary for Debian/x64.
    for (const id of SERVER_COMPONENT_IDS) {
      expect(platformPackage(componentManifest(id), IMAGE_PLATFORM)).not.toBeNull();
    }
  });
});

describe("where a component may be loaded from", () => {
  it("puts the root inside the data dir by default, which is what Start over removes", () => {
    expect(componentsRootDir(withEnv({}))).toBe(resolve(dataDir, "components"));
    // An empty environment still lands under whatever `localDataDir()` resolves to, never at the
    // filesystem root: `HOST_RESET_ENTRIES` names "components" relative to the data dir, and the
    // two have to keep agreeing or "Start over" stops removing it.
    expect(componentsRootDir(DESK).endsWith(`${sep}components`)).toBe(true);
  });

  it("moves the root when the operator names one", () => {
    const root = join(tmpdir(), "agentforge-managed-components");
    expect(componentsRootDir(withEnv({ [COMPONENTS_DIR_ENV]: root }))).toBe(resolve(root));
    expect(managedComponentsRoot(withEnv({ [COMPONENTS_DIR_ENV]: root }))).toBe(resolve(root));
  });

  it("does not call a root inside the data dir managed, however it is spelled", () => {
    // The point of the variable is to put executable content off the tenant volume. A path that
    // lands back inside it buys nothing, and saying otherwise would let `/data` be mounted noexec
    // while a `.node` file under it was still being required.
    for (const inside of [dataDir, join(dataDir, "components"), join(dataDir, "nested", "..", "components")]) {
      expect(managedComponentsRoot(withEnv({ [COMPONENTS_DIR_ENV]: inside }))).toBeNull();
    }
    expect(managedComponentsRoot(withEnv({ [COMPONENTS_DIR_ENV]: "   " }))).toBeNull();
  });

  /**
   * Round 1 finding 6. `isInside` is `path.resolve` only, so it answers about the SPELLING of a
   * path. A link at an outside-looking path whose target is the tenant volume used to read as
   * managed, and its component loaded in server mode — which makes the sentence "no native module
   * is loaded out of `/data`" true of the spelling and not of the inode. Only an operator can
   * plant that link and a real `noexec` mount is enforced by the kernel either way, but the claim
   * has to hold on its own.
   */
  it("refuses a root that only looks outside the data dir, following the link", () => {
    const linkParent = mkdtempSync(join(tmpdir(), "agentforge-components-link-"));
    const link = join(linkParent, "components");
    const target = join(dataDir, "linked-components");
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link, "dir");
    try {
      expect(managedComponentsRoot(withEnv({ [COMPONENTS_DIR_ENV]: link }))).toBeNull();
      expect(downloadedComponentsAllowed(withEnv({ AGENTFORGE_SERVER: "1", [COMPONENTS_DIR_ENV]: link }))).toBe(false);

      // A link pointing anywhere else is still an operator-owned root, so it stays managed.
      const elsewhere = mkdtempSync(join(tmpdir(), "agentforge-components-real-"));
      const outsideLink = join(linkParent, "outside");
      symlinkSync(elsewhere, outsideLink, "dir");
      expect(managedComponentsRoot(withEnv({ [COMPONENTS_DIR_ENV]: outsideLink }))).toBe(resolve(outsideLink));
      rmSync(elsewhere, { recursive: true, force: true });
    } finally {
      rmSync(linkParent, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("lets a desk load from its own data dir, always", () => {
    expect(downloadedComponentsAllowed(DESK)).toBe(true);
    expect(downloadedComponentsAllowed(withEnv({}))).toBe(true);
    expect(downloadedComponentsAllowed(withEnv({ [COMPONENTS_DIR_ENV]: join(dataDir, "components") }))).toBe(true);
  });

  it("refuses the data dir on a server, and allows an operator-owned root", () => {
    expect(downloadedComponentsAllowed(SERVER)).toBe(false);
    expect(
      downloadedComponentsAllowed(
        withEnv({ AGENTFORGE_SERVER: "1", [COMPONENTS_DIR_ENV]: join(dataDir, "components") }),
      ),
    ).toBe(false);
    expect(
      downloadedComponentsAllowed(
        withEnv({ AGENTFORGE_SERVER: "1", [COMPONENTS_DIR_ENV]: join(tmpdir(), "agentforge-opt-components") }),
      ),
    ).toBe(true);
  });
});

describe("the report an operator and the image build read", () => {
  const ready = (source: ComponentSource) => () => source;
  const absent = () => null;

  function probesFor(probe: () => ComponentSource | null): Partial<Record<ComponentId, () => ComponentSource | null>> {
    const probes: Partial<Record<ComponentId, () => ComponentSource | null>> = {};
    for (const id of SERVER_COMPONENT_IDS) {
      probes[id] = probe;
    }
    return probes;
  }

  it("passes when every component loads out of the image", () => {
    const report = serverComponentReport(SERVER, probesFor(ready("bundled")));
    expect(report.ok).toBe(true);
    expect(report.serverMode).toBe(true);
    expect(report.rows.map((row) => row.source)).toEqual(SERVER_COMPONENT_IDS.map(() => "bundled"));
    expect(report.rows.every((row) => row.detail.includes("bundled with the app"))).toBe(true);
  });

  it("passes on a component the operator installed into the components root", () => {
    const report = serverComponentReport(SERVER, probesFor(ready("downloaded")));
    expect(report.ok).toBe(true);
    expect(report.rows.every((row) => row.detail.includes("installed in the components root"))).toBe(true);
  });

  it("fails, and names the version, when one does not load", () => {
    const report = serverComponentReport(SERVER, probesFor(absent));
    expect(report.ok).toBe(false);
    for (const row of report.rows) {
      expect(row.ok).toBe(false);
      expect(row.source).toBeNull();
      expect(row.version).toBe(componentManifest(row.id).version);
    }
  });

  it("reports the managed root so a misconfigured server is visible, not silent", () => {
    expect(serverComponentReport(SERVER, probesFor(ready("bundled"))).managedRoot).toBeNull();
    const root = join(tmpdir(), "agentforge-opt-components");
    const configured = serverComponentReport(
      withEnv({ AGENTFORGE_SERVER: "1", [COMPONENTS_DIR_ENV]: root }),
      probesFor(ready("bundled")),
    );
    expect(configured.managedRoot).toBe(resolve(root));
  });
});
