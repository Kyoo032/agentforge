/**
 * The renderer does not import the host.
 *
 * `@agentforge/host` is the server: it pulls in `@agentforge/db`, `better-sqlite3`, `node:fs` and
 * the whole API dispatch. `apps/web/{components,lib,src}` is what Vite bundles for a browser, and
 * everything there reaches the host over HTTP through `@/lib/api-client`. AGENTS.md "Shell vs app"
 * states the rule; `meeting-recorder-media.ts` duplicates a host constant by hand rather than break
 * it, with a comment explaining why.
 *
 * The rule was already enforced, but only where somebody had thought to look:
 * `component-setup-wiring.test.ts` asserts it for three named files. `hosted-mode-guard.ts` then
 * sat in `apps/web/lib` re-exporting `@agentforge/host/hosted-env` — correct code in the wrong
 * directory, one component import away from dragging the server into a browser bundle, and invisible
 * to a per-file check. It lives in `apps/web/server/` now, and this reads the whole of the
 * renderer's three directories instead of a list of files somebody has to remember to extend.
 *
 * TYPE-ONLY IS ALLOWED. `import type` is erased before a bundler sees it, so it costs nothing at
 * runtime. There is none today; the carve-out exists so that adding one is a deliberate act rather
 * than a reason to weaken the rule.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The three directories a browser bundle is built from. `server/` and `server.ts` are not here. */
const RENDERER_DIRS = ["components", "lib", "src"] as const;

const SOURCE = /\.(ts|tsx)$/;
/** Tests are never bundled — and this file quotes the forbidden import to check its own matcher. */
const TEST = /\.test\.(ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.isFile() && SOURCE.test(entry.name) && !TEST.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** Every `from "@agentforge/host…"` in a file, with the ones `import type` erases left out. */
function hostImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(import|export)\s+([\s\S]*?)from\s+"(@agentforge\/host[^"]*)"/g)) {
    const clause = match[2] ?? "";
    if (/^\s*type\s/.test(clause)) {
      continue;
    }
    found.push(match[3] ?? "");
  }
  return found;
}

describe("nothing a browser bundles imports @agentforge/host", () => {
  const files = RENDERER_DIRS.flatMap((dir) => sourceFiles(join(web, dir)));

  it("reads a non-trivial number of files, so a broken walk cannot pass silently", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds no value import of the host anywhere under components, lib or src", () => {
    const offenders = files
      .map((file) => ({ file: relative(web, file), imports: hostImports(readFileSync(file, "utf8")) }))
      .filter((entry) => entry.imports.length > 0)
      .map((entry) => `${entry.file}: ${entry.imports.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("recognises the shapes it is looking for, so the rule is not a regex that matches nothing", () => {
    expect(hostImports('import { handleNodeRequest } from "@agentforge/host/http";')).toEqual([
      "@agentforge/host/http",
    ]);
    expect(hostImports('export { assertHostedEnvComplete } from "@agentforge/host/hosted-env";')).toEqual([
      "@agentforge/host/hosted-env",
    ]);
    expect(hostImports('import {\n  a,\n  b,\n} from "@agentforge/host";')).toEqual(["@agentforge/host"]);
    // Erased before a bundler sees it, and a comment that merely names the package is not an import.
    expect(hostImports('import type { HostRequest } from "@agentforge/host";')).toEqual([]);
    expect(hostImports("// the renderer must not import from `@agentforge/host`")).toEqual([]);
  });
});

describe("the server half is where the host is allowed", () => {
  it("still re-exports the boot check, from apps/web/server", () => {
    const guard = readFileSync(join(web, "server", "hosted-mode-guard.ts"), "utf8");
    expect(hostImports(guard)).toEqual(["@agentforge/host/hosted-env"]);
  });

  it("and server.ts reaches it there, not through @/lib", () => {
    const server = readFileSync(join(web, "server.ts"), "utf8");
    expect(server).toContain('from "./server/hosted-mode-guard"');
    expect(server).not.toContain("lib/hosted-mode-guard");
  });
});
