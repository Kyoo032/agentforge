import assert from "node:assert/strict";
import { describeMacCoverage, macArtifactNames, selectMacArtifacts } from "./release-artifacts.mjs";

const V = "0.14.22";
const FULL = [
  `DPSBuddy-${V}-mac-x64.dmg`,
  `DPSBuddy-${V}-mac-x64.zip`,
  `DPSBuddy-${V}-mac-arm64.dmg`,
  `DPSBuddy-${V}-mac-arm64.zip`,
];

// ---------- macArtifactNames ----------

assert.deepEqual(macArtifactNames(V).sort(), [...FULL].sort());

// ---------- selectMacArtifacts ----------

{
  const dist = [
    `DPSBuddy Setup ${V}.exe`,
    `DPSBuddy Setup ${V}.exe.blockmap`,
    "latest.yml",
    ...FULL,
    `DPSBuddy-${V}-mac-arm64.zip.blockmap`,
    "latest-mac.yml",
    "DPSBuddy-0.14.21-mac-arm64.dmg",
    "builder-effective-config.yaml",
  ];
  const picked = selectMacArtifacts(dist, V);
  assert.deepEqual(picked.uploads, [...FULL].sort(), "only the current version's dmg + zip");
  assert.deepEqual(picked.stale, ["DPSBuddy-0.14.21-mac-arm64.dmg"]);
  assert.deepEqual(picked.forbidden, ["latest-mac.yml"], "the mac feed is never an upload");
  assert.deepEqual(picked.arches, ["arm64", "x64"]);
  assert.deepEqual(picked.missingArches, []);
  assert.ok(!picked.uploads.some((n) => n.endsWith(".blockmap")), "mac blockmaps are ignored");
  assert.ok(!picked.uploads.some((n) => n.endsWith(".exe")), "the Windows exe is not a mac upload");
}

{
  const picked = selectMacArtifacts([`DPSBuddy-${V}-mac-arm64.dmg`, "latest.yml"], V);
  assert.deepEqual(picked.uploads, [`DPSBuddy-${V}-mac-arm64.dmg`]);
  assert.deepEqual(picked.arches, ["arm64"]);
  assert.deepEqual(picked.missingArches, ["x64"], "half a mac release is reported, not hidden");
}

{
  const picked = selectMacArtifacts([`DPSBuddy Setup ${V}.exe`, "latest.yml"], V);
  assert.deepEqual(picked, { uploads: [], stale: [], forbidden: [], arches: [], missingArches: ["x64", "arm64"] });
}

// version is matched literally, not as a regex prefix
{
  const picked = selectMacArtifacts([`DPSBuddy-0.14.2-mac-x64.dmg`, `DPSBuddy-0.14.22-mac-x64.dmg`], "0.14.2");
  assert.deepEqual(picked.uploads, ["DPSBuddy-0.14.2-mac-x64.dmg"]);
  assert.deepEqual(picked.stale, ["DPSBuddy-0.14.22-mac-x64.dmg"]);
}

// ---------- describeMacCoverage ----------

assert.equal(describeMacCoverage(selectMacArtifacts([], V)), "no mac artifacts in dist (Windows-only release)");
assert.equal(
  describeMacCoverage(selectMacArtifacts([`DPSBuddy-${V}-mac-arm64.dmg`], V)),
  `mac arm64: DPSBuddy-${V}-mac-arm64.dmg; missing x64`,
);
assert.match(describeMacCoverage(selectMacArtifacts(FULL, V)), /^mac arm64 \+ x64: /);

console.log("release-artifacts.test.mjs: ok");
