/**
 * The refusal list both public release repos share. AGENTS.md, "Three repos": notes come only from
 * docs/public/, never from docs/internal/, and never carry an AI or agent mark.
 *
 *   scripts/release-web.mjs                   -> Kyoo032/DPSBuddy-Ent, the Enterprise deploy bundle
 *   apps/desktop/scripts/release-desktop.mjs  -> Kyoo032/DPSBuddy, the Personal installers
 *
 * One list in one module, so the two products cannot drift apart on it.
 */
import { resolve } from "node:path";

/** Words that must never reach a public repo. Matched case-insensitively as substrings. */
export const FORBIDDEN_MARKS = Object.freeze(["Claude", "Anthropic", "agent", "Co-Authored", "docs/internal"]);

/** The forbidden marks present in the text, in FORBIDDEN_MARKS order. */
export function forbiddenMarksIn(text) {
  const lower = text.toLowerCase();
  return FORBIDDEN_MARKS.filter((mark) => lower.includes(mark.toLowerCase()));
}

/**
 * True when a path lands in a docs/internal folder, in any letter case and with either separator.
 * Windows and the default macOS volume are case-insensitive, so `Docs\Internal\x.md` opens the same
 * file as `docs/internal/x.md` and has to be refused the same way. The path is resolved first, which
 * also catches `docs/public/../internal/x.md`. A link is not followed here: for an existing file,
 * check `realpathSync.native(file)` as well to see where it really points.
 */
export function isInternalDocsPath(path) {
  return resolve(path).replace(/\\/g, "/").toLowerCase().includes("docs/internal");
}
