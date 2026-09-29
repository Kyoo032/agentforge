import assert from "node:assert/strict";
import { describeMacCoverage, macArtifactNames, selectMacArtifacts } from "./release-artifacts.mjs";

const V = "0.14.22";
const FULL = [
  `Nultron-${V}-mac-x64.dmg`,
  `Nultron-${V}-mac-x64.zip`,
  `Nultron-${V}-mac-arm64.dmg`,
  `Nultron-${V}-mac-arm64.zip`,
];

// ---------- macArtifactNames ----------

assert.deepEqual(macArtifactNames(V).sort(), [...FULL].sort());

// ---------- selectMacArtifacts ----------

{
  const dist = [
    `Nultron Setup ${V}.exe`,
    `Nultron Setup ${V}.exe.blockmap`,
    "latest.yml",
    ...FULL,
    `Nultron-${V}-mac-arm64.zip.blockmap`,
    "latest-mac.yml",
    "Nultron-0.14.21-mac-arm64.dmg",
    "builder-effective-config.yaml",
  ];
  const picked = selectMacArtifacts(dist, V);
  assert.deepEqual(picked.uploads, [...FULL].sort(), "only the current version's dmg + zip");
  assert.deepEqual(picked.stale, ["Nultron-0.14.21-mac-arm64.dmg"]);
  assert.deepEqual(picked.forbidden, ["latest-mac.yml"], "the mac feed is never an upload");
  assert.deepEqual(picked.arches, ["arm64", "x64"]);
  assert.deepEqual(picked.missingArches, []);
  assert.ok(!picked.uploads.some((n) => n.endsWith(".blockmap")), "mac blockmaps are ignored");
  assert.ok(!picked.uploads.some((n) => n.endsWith(".exe")), "the Windows exe is not a mac upload");
}

{
  const picked = selectMacArtifacts([`Nultron-${V}-mac-arm64.dmg`, "latest.yml"], V);
  assert.deepEqual(picked.uploads, [`Nultron-${V}-mac-arm64.dmg`]);
  assert.deepEqual(picked.arches, ["arm64"]);
  assert.deepEqual(picked.missingArches, ["x64"], "half a mac release is reported, not hidden");
}

{
  const picked = selectMacArtifacts([`Nultron Setup ${V}.exe`, "latest.yml"], V);
  assert.deepEqual(picked, { uploads: [], stale: [], forbidden: [], arches: [], missingArches: ["x64", "arm64"] });
}

// version is matched literally, not as a regex prefix
{
  const picked = selectMacArtifacts([`Nultron-0.14.2-mac-x64.dmg`, `Nultron-0.14.22-mac-x64.dmg`], "0.14.2");
  assert.deepEqual(picked.uploads, ["Nultron-0.14.2-mac-x64.dmg"]);
  assert.deepEqual(picked.stale, ["Nultron-0.14.22-mac-x64.dmg"]);
}

// A dist/ left over from the DPSBuddy era: its mac files are neither uploaded nor flagged stale,
// so a Nultron release never attaches an installer under the old name.
{
  const picked = selectMacArtifacts([`DPSBuddy-${V}-mac-arm64.dmg`, `DPSBuddy-0.14.21-mac-x64.zip`, ...FULL], V);
  assert.deepEqual(picked.uploads, [...FULL].sort());
  assert.deepEqual(picked.stale, []);
}

// ---------- describeMacCoverage ----------

assert.equal(describeMacCoverage(selectMacArtifacts([], V)), "no mac artifacts in dist (Windows-only release)");
assert.equal(
  describeMacCoverage(selectMacArtifacts([`Nultron-${V}-mac-arm64.dmg`], V)),
  `mac arm64: Nultron-${V}-mac-arm64.dmg; missing x64`,
);
assert.match(describeMacCoverage(selectMacArtifacts(FULL, V)), /^mac arm64 \+ x64: /);

console.log("release-artifacts.test.mjs: ok");
