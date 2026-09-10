/**
 * Which files in dist/ belong to a release, per platform. Pure so release-desktop.mjs can be
 * tested without a packed build.
 *
 * Windows: the NSIS exe, its blockmap and latest.yml (the updater feed).
 * macOS:   DPSBuddy-<version>-mac-<arch>.dmg / .zip, built on a Mac and copied into dist/.
 *          latest-mac.yml and *.blockmap for mac are never uploaded: the mac app is unsigned,
 *          its updater is off, and a feed it cannot consume must not exist on the release.
 */

export const MAC_ARCHES = Object.freeze(["x64", "arm64"]);
export const MAC_EXTENSIONS = Object.freeze(["dmg", "zip"]);
const MAC_ARTIFACT = /^DPSBuddy-(\d+\.\d+\.\d+[^-]*)-mac-(x64|arm64)\.(dmg|zip)$/;
const MAC_FEED = /^latest-mac\.yml$/i;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** All asset names a complete mac release would carry for this version. */
export function macArtifactNames(version) {
  return MAC_ARCHES.flatMap((arch) => MAC_EXTENSIONS.map((ext) => `DPSBuddy-${version}-mac-${arch}.${ext}`));
}

/**
 * Sort dist/ entries into mac uploads for `version`, stale mac artifacts from other versions,
 * and forbidden feed files. Blockmaps for mac are ignored (not stale, not uploaded).
 * @param {string[]} entries basenames in dist/
 * @param {string} version package.json version
 */
export function selectMacArtifacts(entries, version) {
  const current = new RegExp(`^DPSBuddy-${escapeRegExp(version)}-mac-(x64|arm64)\\.(dmg|zip)$`);
  const uploads = entries.filter((name) => current.test(name)).sort();
  const stale = entries.filter((name) => MAC_ARTIFACT.test(name) && !current.test(name)).sort();
  const forbidden = entries.filter((name) => MAC_FEED.test(name)).sort();
  const arches = [...new Set(uploads.map((name) => MAC_ARTIFACT.exec(name)[2]))].sort();
  const missingArches = MAC_ARCHES.filter((arch) => !arches.includes(arch));
  return { uploads, stale, forbidden, arches, missingArches };
}

/** Human line for the log: what mac coverage this release has. */
export function describeMacCoverage(selection) {
  if (selection.uploads.length === 0) {
    return "no mac artifacts in dist (Windows-only release)";
  }
  const missing = selection.missingArches.length ? `; missing ${selection.missingArches.join(", ")}` : "";
  return `mac ${selection.arches.join(" + ")}: ${selection.uploads.join(", ")}${missing}`;
}
