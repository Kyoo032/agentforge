#!/usr/bin/env node
// Re-anchor `file:line` citations in the maps after code has moved.
//
// map-rot.mjs answers "is this citation broken?". This answers the other question, the one that
// actually rots a map page: "did the code under this citation move?". A line that merely shifted
// down still points at a real line in a real file, so map-rot cannot see it — see the "Checking for
// rot" section of docs/internal/maps/README.md.
//
//   node scripts/map-drift.mjs <old-ref> [new-ref]        # report
//   node scripts/map-drift.mjs <old-ref> [new-ref] --write # rewrite the citations in place
//
// <old-ref> is the commit the pages were last verified at (their `Last verified:` line); <new-ref>
// defaults to HEAD. Every citation into a file that changed between the two refs is mapped through
// the diff. A citation whose line was deleted or rewritten cannot be mapped and is reported as
// UNMAPPED: that one needs a person, because the sentence around it may no longer be true.
//
// Lines the newer ref itself added to a doc are left alone — they were written against the new code.
//
// NOT IDEMPOTENT. It rewrites <old-ref> coordinates into <new-ref> coordinates, so running it twice
// shifts everything twice. Run it once, from the sha on the pages' own `Last verified:` line, then
// bump that line to <new-ref>. Running it again from the new sha is the check that it is settled:
// a clean tree reports zero.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOC_ROOTS = ["docs", ".cursor"];
const EXTRA_DOCS = ["webapp-deploy/README.md"];
const CODE_ROOTS = "apps|packages|scripts|webapp-deploy";
const CODE_EXT = "tsx|ts|mjs|cjs|json|js|sql|sh|yaml|yml";
const CITE = new RegExp(`((?:${CODE_ROOTS})/[A-Za-z0-9_@./+-]+?\\.(?:${CODE_EXT})):(\\d+)(?:([-–])(\\d+))?`, "g");

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const argv = process.argv.slice(2);
const write = argv.includes("--write");
const [oldRef, newRef = "HEAD"] = argv.filter((a) => !a.startsWith("--"));
if (!oldRef) {
	console.error("usage: node scripts/map-drift.mjs <old-ref> [new-ref] [--write]");
	process.exit(2);
}

/**
 * old line -> new line, from `git diff -U0` hunk headers. A line inside a hunk's old range was
 * deleted or rewritten, so it maps to null rather than to a guess.
 */
function lineMap(file) {
	let diff;
	try {
		diff = git("diff", "-U0", oldRef, newRef, "--", file);
	} catch {
		return null;
	}
	const hunks = [];
	for (const line of diff.split("\n")) {
		const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (m) {
			hunks.push({
				oldStart: Number(m[1]),
				oldCount: m[2] === undefined ? 1 : Number(m[2]),
				newStart: Number(m[3]),
				newCount: m[4] === undefined ? 1 : Number(m[4]),
			});
		}
	}
	return (n) => {
		let offset = 0;
		for (const h of hunks) {
			// A pure insertion has oldCount 0 and sits *after* line oldStart.
			const firstDeleted = h.oldCount === 0 ? h.oldStart + 1 : h.oldStart;
			const lastDeleted = h.oldStart + h.oldCount - 1;
			if (h.oldCount > 0 && n >= firstDeleted && n <= lastDeleted) {
				return null;
			}
			if (n >= firstDeleted) {
				offset += h.newCount - h.oldCount;
			}
		}
		return n + offset;
	};
}

const changed = git("diff", "--name-only", oldRef, newRef, "--", "apps", "packages", "scripts", "webapp-deploy")
	.split("\n")
	.map((s) => s.trim())
	.filter((s) => s && !/\.test\.|__tests__/.test(s));
const maps = new Map();
for (const f of changed) {
	const m = lineMap(f);
	if (m) maps.set(f, m);
}

/** Lines <new-ref> added to a doc: they already carry new coordinates, so leave them alone. */
function addedByNewRef(doc) {
	let diff;
	try {
		diff = git("diff", oldRef, newRef, "--", doc);
	} catch {
		return new Set();
	}
	const added = new Set();
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added.add(line.slice(1).trim());
	}
	return added;
}

const docs = [];
for (const root of DOC_ROOTS) {
	const listed = git("ls-files", "--", root)
		.split("\n")
		.filter((f) => f.endsWith(".md"));
	docs.push(...listed);
}
docs.push(...EXTRA_DOCS.filter((f) => existsSync(path.join(ROOT, f))));

let moved = 0;
const unmapped = [];
for (const doc of docs) {
	const abs = path.join(ROOT, doc);
	if (!existsSync(abs)) continue;
	const source = readFileSync(abs, "utf8");
	const skip = addedByNewRef(doc);
	const hits = [];
	const out = source
		.split("\n")
		.map((line) => {
			if (skip.has(line.trim())) return line;
			return line.replace(CITE, (whole, file, a, dash, b) => {
				const map = maps.get(file);
				if (!map) return whole;
				const start = Number(a);
				const end = b === undefined ? start : Number(b);
				const ns = map(start);
				const ne = map(end);
				if (ns === null || ne === null) {
					unmapped.push({ doc, cite: whole });
					return whole;
				}
				if (ns === start && ne === end) return whole;
				const next = b === undefined ? `${file}:${ns}` : `${file}:${ns}${dash}${ne}`;
				hits.push(`${whole} -> ${next}`);
				moved += 1;
				return next;
			});
		})
		.join("\n");
	if (hits.length === 0) continue;
	if (write) writeFileSync(abs, out);
	console.log(doc);
	for (const h of hits) console.log(`  ${h}`);
}

console.log(`\n${changed.length} code files changed between ${oldRef} and ${newRef}`);
console.log(`${moved} citations ${write ? "re-anchored" : "would move"}, ${unmapped.length} unmapped`);
for (const u of unmapped) console.log(`  UNMAPPED ${u.doc}  ${u.cite}`);
if (unmapped.length > 0) {
	console.log("\nAn unmapped citation's line was deleted or rewritten. Read the code and the sentence:");
	console.log("the claim around it may no longer be true, which no line number can fix.");
}
process.exit(0);
