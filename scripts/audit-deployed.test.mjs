/**
 * Tests for scripts/audit-deployed.mjs.
 *
 * Node's own test runner rather than vitest: this script is repo tooling and lives outside every
 * workspace package, so no package's vitest config would ever collect it. `node --test scripts/`
 * runs it, and `.github/workflows/ci.yml` does exactly that.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { atOrAbove, closureNames, partition } from "./audit-deployed.mjs";

/** The shape `pnpm list --depth Infinity --json` prints, trimmed to what the script reads. */
const list = [
  {
    name: "@agentforge/web",
    dependencies: {
      react: { version: "19.2.8" },
      ai: {
        version: "5.0.40",
        dependencies: { "@ai-sdk/provider-utils": { version: "3.0.12" } },
      },
    },
    devDependencies: {
      // tsx is a devDependency and IS the production entrypoint, so it ships; see the script.
      tsx: { version: "4.20.6", dependencies: { esbuild: { version: "0.24.2" } } },
    },
  },
];

function advisory(module_name, severity) {
  return { module_name, severity, title: `${module_name} is unhappy`, patched_versions: ">=9" };
}

test("collects every name in the tree, at any depth and from dev dependencies too", () => {
  const names = closureNames(list);
  assert.ok(names.has("react"));
  assert.ok(names.has("@ai-sdk/provider-utils"), "a transitive dependency counts");
  assert.ok(names.has("esbuild"), "a devDependency's own dependency ships in the image");
  assert.equal(names.size, 5);
});

test("survives a node with no children and a root with no groups", () => {
  assert.equal(closureNames([{ name: "x" }]).size, 0);
  assert.equal(closureNames([]).size, 0);
});

test("does not loop forever on a cyclic tree", () => {
  const cycle = { version: "1.0.0" };
  cycle.dependencies = { a: cycle };
  assert.equal(closureNames([{ dependencies: { a: cycle } }]).size, 1);
});

test("splits advisories by whether the image carries the package", () => {
  const audit = {
    advisories: {
      1: advisory("esbuild", "moderate"),
      2: advisory("electron", "critical"),
      3: advisory("tar", "high"),
      4: advisory("react", "low"),
    },
  };
  const { inImage, elsewhere } = partition(audit, closureNames(list));
  assert.deepEqual(
    inImage.map((a) => a.module_name),
    ["esbuild", "react"],
  );
  assert.deepEqual(
    elsewhere.map((a) => a.module_name),
    ["electron", "tar"],
    "sorted worst first",
  );
});

test("an empty report is not an error", () => {
  const { inImage, elsewhere } = partition({}, closureNames(list));
  assert.deepEqual(inImage, []);
  assert.deepEqual(elsewhere, []);
});

test("the gate counts only what is at or above the level", () => {
  const found = [advisory("a", "critical"), advisory("b", "high"), advisory("c", "moderate"), advisory("d", "low")];
  assert.equal(atOrAbove(found, "high").length, 2);
  assert.equal(atOrAbove(found, "critical").length, 1);
  assert.equal(atOrAbove(found, "low").length, 4);
});

/**
 * The state of the repo today, and the reason the gate is set where it is: the 1 critical and 19
 * high the workspace-wide audit reports are all reachable only from `apps/desktop`. If a high ever
 * does land in the web closure this flips, which is the point.
 */
test("a high in the image blocks, and the same high outside it does not", () => {
  const audit = { advisories: { 1: advisory("tar", "high") } };
  const outside = partition(audit, closureNames(list));
  assert.equal(atOrAbove(outside.inImage, "high").length, 0);

  const withTar = closureNames([{ dependencies: { tar: { version: "6.2.0" } } }]);
  const inside = partition(audit, withTar);
  assert.equal(atOrAbove(inside.inImage, "high").length, 1);
});
