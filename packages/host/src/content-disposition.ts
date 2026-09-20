/**
 * Building a `Content-Disposition: attachment` header from a filename that came out of a document.
 *
 * Lifted out of `handlers/artifacts.ts` so the HTTP adapter can apply it to EVERY bytes result
 * rather than only to the one handler that remembered (docs/internal/security-owasp-2026-09.md,
 * A03-1). Two separate problems, one place to fix them:
 *
 *  1. QUOTING. A bare `"` or `\` in the name ends the quoted string and starts a parameter of its
 *     own. Node already refuses CR and LF in a header value, so header splitting is not the risk;
 *     parameter injection is. Every producer of a `filename` today runs the title through a
 *     `[^\w\s-]` slugifier first, so nothing is exploitable — but that is a property of five call
 *     sites agreeing, and one new download route with a less careful name would end it.
 *
 *  2. NON-LATIN1. `res.setHeader` throws `ERR_INVALID_CHAR` on anything above U+00FF, so a title in
 *     Chinese, Japanese, Arabic or Thai would have turned a download into an uncaught 500. The
 *     product ships in English and Indonesian and takes arbitrary document titles, so this is a
 *     matter of time rather than of malice. RFC 6266 / RFC 5987 answer it: an ASCII `filename` for
 *     old clients plus a percent-encoded `filename*` that every current browser prefers.
 */

/** A quote, a backslash or a control byte would end the parameter or start a header of its own. */
function isUnsafeFilenameChar(char: string): boolean {
  return char < " " || char === "\u007f" || char === '"' || char === "\\";
}

/**
 * The name as it can appear between double quotes: unsafe characters become spaces, runs of
 * whitespace collapse, and the result is trimmed.
 *
 * (The version this replaces tested `char === ""`, which is never true — a DEL that was lost
 * somewhere in the file's history. `\u007f` is what was meant, and is what is checked now.)
 */
export function quotableFilename(filename: string): string {
  return Array.from(filename, (char) => (isUnsafeFilenameChar(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Anything a header value cannot carry becomes `_`, so the quoted parameter is always sendable. */
function asciiFilename(filename: string): string {
  const folded = Array.from(quotableFilename(filename), (char) => (char > "~" ? "_" : char)).join("");
  return folded.replace(/_+/g, "_").trim() || "download";
}

/** RFC 5987 `attr-char`: everything else is percent-encoded, `'` and `*` included. */
function rfc5987(filename: string): string {
  return Array.from(filename)
    .map((char) =>
      /^[A-Za-z0-9!#$&+\-.^_`|~]$/.test(char)
        ? char
        : Array.from(new TextEncoder().encode(char))
            .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
            .join(""),
    )
    .join("");
}

/**
 * The whole header value. `filename*` is added only when it says something the ASCII form does not,
 * so the common case — a slugified `finance-report.xlsx` — is byte-for-byte the header this app has
 * always sent.
 */
export function contentDispositionAttachment(filename: string): string {
  const ascii = asciiFilename(filename);
  const utf8 = quotableFilename(filename).trim();
  const base = `attachment; filename="${ascii}"`;
  return utf8 && utf8 !== ascii ? `${base}; filename*=UTF-8''${rfc5987(utf8)}` : base;
}
