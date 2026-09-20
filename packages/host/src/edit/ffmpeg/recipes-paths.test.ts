import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A03-3. Every path `recipes.ts` builds inside the scratch root is handed to ffmpeg, which reads
 * and writes it for real, so each one has to go through `assertInsidePath` before it is used.
 *
 * `frameAt` was the one that did not: `path.join(scratch, \`parity-${frame}.ass\`)` went straight to
 * `writeFile`. `frame` is typed a number, but it arrives off a JSON request body, and a type is not
 * a check — a string there walks out of the scratch root and writes an arbitrary file as the app
 * user. Its sibling on the very next line already did the right thing, which is exactly how the gap
 * stayed invisible.
 *
 * This is a source test rather than a behavioural one on purpose: `frameAt` and `render` shell out
 * to ffmpeg, so exercising them means either a real binary or mocking away the thing under test.
 * What actually needs guarding is the rule "no scratch path reaches ffmpeg unchecked", and that is
 * a property of the file, so the file is what is read.
 */
const source = readFileSync(fileURLToPath(new URL("./recipes.ts", import.meta.url)), "utf8");

describe("every scratch path in recipes.ts is checked before it is used", () => {
  it("reads the module this test is pinned against", () => {
    expect(source).toContain("export async function frameAt");
    expect(source).toContain("export async function render");
  });

  it("wraps every path.join(scratch, …) in assertInsidePath", () => {
    const joins = source.split("\n").filter((line) => line.includes("path.join(scratch,"));
    // mkdir(scratch) aside, the scratch root is only ever joined to make a file for ffmpeg.
    expect(joins.length).toBeGreaterThanOrEqual(6);
    for (const line of joins) {
      expect(line, line.trim()).toContain("assertInsidePath(path.join(scratch,");
    }
  });

  it("checks the parity subtitle path that frameAt used to write blind", () => {
    const dollar = "$";
    // Phase 3 lane D renamed the second argument: `roots` was a bare `string[]`, and is now the
    // `PathAllowlist` (`allow`) that carries the denied roots keeping one tenant out of another's
    // subtree. The guard being pinned here is unchanged — this path still goes through
    // `assertInsidePath` before `writeFile` — so only the spelling of the allowlist moved.
    expect(source).toContain(`assertInsidePath(path.join(scratch, \`parity-${dollar}{frame}.ass\`), allow)`);
    // And it is the same allowlist `frameAt` builds for this tenant and project, not a wider one.
    expect(source).toContain("const allow = editAllowlist({ tenantId, projectId: doc.id });");
  });
});
