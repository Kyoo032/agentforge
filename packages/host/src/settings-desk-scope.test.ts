import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HOST_SRC = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HOST_SRC, "../../..");

/**
 * `loadSettings()` with no desk falls back to whatever `workspace-id.txt` says, which is nobody's
 * desk until something stamps it. Every runtime read must name the desk it is running for, or an
 * owner who pasted a key on Default gets `runtime_stub` from every job — and the desktop shell
 * records a "stub" host-status on a fresh install.
 *
 * An explicit `undefined` / `null` / `""` argument resolves exactly like no argument at all, so the
 * pattern catches those too: they are the same bug wearing a parameter.
 */
const BARE_CALL = /\bloadSettings\(\s*(\)|undefined|null|""|'')/;

/** Files owned by another change in flight. Drop them once they thread the desk too. */
const NOT_MINE = new Set([
  join("packages", "host", "src", "studio-generate.ts"),
  join("packages", "host", "src", "handlers", "jobs.ts"),
]);

/** Genuinely machine-wide reads. Each one needs a comment at the call site saying why. */
const MACHINE_WIDE: string[] = [];

/** Every surface that can reach `loadSettings`: the host itself and the two shells that re-export it. */
const ROOTS = [
  { dir: join(REPO, "packages", "host", "src"), extensions: [".ts"] },
  { dir: join(REPO, "apps", "desktop"), extensions: [".cjs"], shallow: true },
  { dir: join(REPO, "apps", "desktop", "src"), extensions: [".ts"] },
];
const EXTRA_FILES = [join(REPO, "apps", "web", "server.ts")];

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "resources", "scripts"]);

function walk(dir: string, extensions: string[], shallow: boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!shallow && !SKIP_DIRS.has(entry)) {
        walk(full, extensions, shallow, out);
      }
    } else if (extensions.some((ext) => entry.endsWith(ext)) && !/\.test\.[cm]?[jt]s$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Blank out `//` and `/* *\/` comments before matching, so prose that names the bug (this file's own
 * doc comments, and the one in tenant.ts explaining the fix) never counts as an offender.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\r\n]/g, " ")).replace(/\/\/[^\r\n]*/g, "");
}

describe("settings reads name the desk they run for", () => {
  it("leaves no deskless loadSettings outside the documented exceptions", () => {
    const files = [...ROOTS.flatMap((root) => walk(root.dir, root.extensions, root.shallow === true)), ...EXTRA_FILES];
    expect(files.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const file of files) {
      if (!existsSync(file)) {
        continue;
      }
      const rel = relative(REPO, file);
      if (NOT_MINE.has(rel) || MACHINE_WIDE.includes(rel)) {
        continue;
      }
      withoutComments(readFileSync(file, "utf8"))
        .split(/\r?\n/)
        .forEach((line, index) => {
          if (BARE_CALL.test(line)) {
            offenders.push(`${rel}:${index + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
