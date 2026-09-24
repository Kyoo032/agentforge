/**
 * A repository-wide guard, not a unit test.
 *
 * `privacy.test.ts` proves today's call sites keep the sockets shut. This one makes sure tomorrow's
 * cannot: it reads every source file under packages/ and apps/ and fails if any of them passes an
 * `ocr:` option anywhere near the converter, or mentions a Firecrawl API variable at all. Those two
 * strings are the only way a document could be sent to Firecrawl Parse, so forbidding the strings
 * forbids the behaviour — and a reviewer reading a diff does not have to notice a third argument.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** packages/host/src/file-extract → the repository root. */
const REPO_ROOT = join(HERE, "..", "..", "..", "..");
const ROOTS = ["packages", "apps"] as const;
const SKIP_DIRS = new Set(["node_modules", "_ref", "dist", ".turbo", "coverage", ".next", "build", ".git"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** This file quotes the forbidden strings to describe them, so it is the one file exempt. */
const SELF = "no-hosted-ocr.test.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) {
      return [];
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return SOURCE.test(entry) && !full.endsWith(SELF) ? [full] : [];
  });
}

const FILES = ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)));

/** `ocr:` in a file that also names the converter — the exact shape of a hosted-OCR call. */
const OCR_OPTION = /\bocr\s*:/;
const ANYDOC = /anydoc/i;
const FIRECRAWL_ENV = /FIRECRAWL_API/;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:"'`\\])\/\/.*$/gm;

/**
 * Comments are stripped first, so a file is free to *explain* the option it must never pass — which
 * `anydoc.ts` and `errors.ts` both do. Only executable text is searched.
 */
function withoutComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

/**
 * Every file read and stripped once, beside the walk. Both cases search the same text, and reading
 * some 1,600 files twice, once per case, was nearly all they cost: over a second each on a quiet
 * desk, against a 5 s budget, before any load.
 */
const SCANNED = FILES.map((file) => ({ file, text: withoutComments(readFileSync(file, "utf8")) }));

function offenders(predicate: (text: string) => boolean): string[] {
  return SCANNED.filter(({ text }) => predicate(text)).map(({ file }) =>
    relative(REPO_ROOT, file).split(sep).join("/"),
  );
}

describe("no source file can reach hosted OCR", () => {
  it("finds source files to check at all", () => {
    // A broken walk would make every assertion below vacuously true.
    expect(FILES.length).toBeGreaterThan(200);
  });

  it("passes no `ocr:` option anywhere the converter is used", () => {
    expect(offenders((text) => ANYDOC.test(text) && OCR_OPTION.test(text))).toEqual([]);
  });

  it("never names a Firecrawl API variable", () => {
    expect(offenders((text) => FIRECRAWL_ENV.test(text))).toEqual([]);
  });
});
