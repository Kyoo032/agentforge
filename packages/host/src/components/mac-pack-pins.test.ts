/**
 * The mac pack script carries its own copy of the darwin integrity strings, and nothing tied the
 * two together.
 *
 * `apps/desktop/platform/macos/docker/build-mac.sh` cannot import `manifest.ts` — it is bash running
 * in a Linux container, downloading the darwin packages itself because a Linux `pnpm install` fetches
 * the wrong ones. So it repeats the sha512 for each arch in an `anydoc_integrity()` case block, with
 * a comment saying "same strings" and `docs/internal/maps/component-installer.md` saying "bump the
 * manifest and that script together". A comment is not a check: bump `ANYDOC_VERSION` here and the
 * script keeps asserting the old hashes, and the next mac pack dies inside Docker with a sha512
 * mismatch on a tarball that is in fact correct.
 *
 * This is the check. It reads the script, pulls the version guard and both arch hashes back out of
 * it, and holds them against the manifest this subsystem actually installs from. It fails closed and
 * says which arch drifted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { componentManifest, platformPackage } from "./manifest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** packages/host/src/components → the repository root. */
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "apps", "desktop", "platform", "macos", "docker", "build-mac.sh");

const script = readFileSync(SCRIPT, "utf8").replace(/\r\n/g, "\n");
const entry = componentManifest("anydoc");

/** `arm64) echo "<base64>" ;;` — the bare base64 the script compares `openssl dgst` output against. */
function scriptIntegrity(arch: string): string | null {
  const match = script.match(new RegExp(`${arch}\\)\\s*echo\\s*"([^"]+)"`));
  return match ? match[1] : null;
}

/** The manifest stores SRI (`sha512-<base64>`); the script compares the raw base64. */
function manifestIntegrity(arch: string): string {
  const pkg = platformPackage(entry, `darwin-${arch}`);
  if (!pkg) {
    throw new Error(`the manifest has no darwin-${arch} package`);
  }
  return pkg.integrity.replace(/^sha512-/, "");
}

describe("build-mac.sh agrees with the component manifest", () => {
  it.each(["arm64", "x64"])("pins the same sha512 for darwin-%s", (arch) => {
    expect(scriptIntegrity(arch), `build-mac.sh has no anydoc_integrity case for ${arch}`).not.toBeNull();
    expect(scriptIntegrity(arch)).toBe(manifestIntegrity(arch));
  });

  it("still guards the version against this file", () => {
    // The script greps manifest.ts for the version it found in node_modules, so the spelling of that
    // grep is part of the contract too: change the constant's name here and the guard silently stops
    // matching anything, which `grep -q` reports as a failure — but only on a mac pack.
    expect(script).toContain('ANYDOC_VERSION = \\"$ANYDOC_VERSION\\"');
    expect(readFileSync(join(HERE, "manifest.ts"), "utf8")).toContain(`ANYDOC_VERSION = "${entry.version}"`);
  });

  it("names every darwin arch the manifest carries", () => {
    const fromManifest = Object.keys(entry.platforms)
      .filter((key) => key.startsWith("darwin-"))
      .map((key) => key.slice("darwin-".length))
      .sort();
    for (const arch of fromManifest) {
      expect(scriptIntegrity(arch), `build-mac.sh cannot pack darwin-${arch}`).not.toBeNull();
    }
  });
});
