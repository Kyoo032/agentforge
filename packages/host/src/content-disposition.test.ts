import { ServerResponse } from "node:http";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { contentDispositionAttachment, quotableFilename } from "./content-disposition";

/** A real ServerResponse, so `setHeader`'s own validation is what judges the value. */
function realResponse(): ServerResponse {
  return new ServerResponse(new IncomingMessage(new Socket()));
}

describe("contentDispositionAttachment", () => {
  it("leaves the common slugified name byte-for-byte as it always was", () => {
    expect(contentDispositionAttachment("finance-report.xlsx")).toBe('attachment; filename="finance-report.xlsx"');
  });

  it("adds filename* only when it says something the ASCII form does not", () => {
    expect(contentDispositionAttachment("report.pdf")).not.toContain("filename*");
    expect(contentDispositionAttachment("季度报告.pdf")).toContain("filename*=UTF-8''");
  });

  /**
   * A03-1, the half that was a live 500. `res.setHeader` throws ERR_INVALID_CHAR above U+00FF, and
   * the product ships in English and Indonesian while taking arbitrary document titles, so a
   * Chinese, Japanese, Arabic or Thai title turned a download into an uncaught error.
   */
  it("is accepted by a real setHeader for names Node would otherwise refuse", () => {
    for (const name of ["季度报告.pdf", "مستند.docx", "รายงาน.xlsx", "Ω≈ç√.txt", "naïve café.pdf"]) {
      const res = realResponse();
      expect(() => res.setHeader("Content-Disposition", contentDispositionAttachment(name)), name).not.toThrow();
    }
  });

  it("throws on those names without this builder, which is the bug it replaces", () => {
    const res = realResponse();
    expect(() => res.setHeader("Content-Disposition", 'attachment; filename="季度报告.pdf"')).toThrow();
  });

  /**
   * The other half: a quote or a backslash would close the quoted string and start a parameter of
   * the caller's choosing. Every producer slugifies today, so nothing was exploitable — but that is
   * a property of five call sites agreeing, not of the header builder.
   */
  it("does not let a quote or a backslash open a parameter of its own", () => {
    const header = contentDispositionAttachment('evil".pdf"; filename="owned.exe');
    const quoted = header.slice('attachment; filename="'.length, header.indexOf('"', 'attachment; filename="'.length));
    // A `;` INSIDE the quoted string is legal and harmless; what must not survive is a quote or a
    // backslash, because either one ends the string and lets a second parameter start.
    expect(quoted).not.toContain('"');
    expect(quoted).not.toContain("\\");
    expect(header).not.toMatch(/filename="[^"]*";\s*filename="owned\.exe/);
    // Exactly two quote characters, so there is exactly one quoted string and the `filename=` that
    // survives inside it is part of the name rather than a second parameter.
    expect(header.match(/"/g)).toHaveLength(2);
  });

  it("never emits a bare CR or LF, so no header can be split", () => {
    const header = contentDispositionAttachment("a\r\nX-Evil: 1\r\n.pdf");
    expect(header).not.toMatch(/[\r\n]/);
    expect(() => realResponse().setHeader("Content-Disposition", header)).not.toThrow();
  });

  it("falls back to a usable name when nothing survives", () => {
    expect(contentDispositionAttachment("")).toContain('filename="download"');
    expect(contentDispositionAttachment("\u0000\u007f")).toContain('filename="download"');
  });

  it("percent-encodes the apostrophe and star that RFC 5987 reserves", () => {
    // Needs a non-ASCII character to get a `filename*` at all: a pure-ASCII name is deliberately
    // sent as the bare quoted form it always was, apostrophes and stars included.
    const header = contentDispositionAttachment("o'brien*caf\u00e9.pdf");
    const star = header.slice(header.indexOf("filename*=UTF-8''") + "filename*=UTF-8''".length);
    expect(star).toContain("%27");
    expect(star).toContain("%2A");
    expect(star).not.toContain("'");
    expect(star).not.toContain("*");
  });

  it("leaves a pure-ASCII apostrophe or star alone, with no filename* at all", () => {
    expect(contentDispositionAttachment("o'brien*.pdf")).toBe(`attachment; filename="o'brien*.pdf"`);
  });
});

describe("quotableFilename", () => {
  /**
   * The version this replaced tested `char === ""`, which is never true — a DEL lost somewhere in
   * the file's history. `\u007f` is what was meant.
   */
  it("strips DEL, which the dead check it replaces never caught", () => {
    expect(quotableFilename("a\u007fb")).toBe("a b");
  });

  it("collapses runs of whitespace and trims", () => {
    expect(quotableFilename("  a \t\t b  ")).toBe("a b");
  });
});
