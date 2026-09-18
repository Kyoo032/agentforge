import { describe, expect, it } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { ApiError } from "@agentforge/core";
import { buildGarbagePdf, buildTextPdf } from "@agentforge/core/pdf/test-fixtures";
import { buildZipBomb } from "@agentforge/core/docx/test-fixtures";
import { docxFixture, pptxFixture, rtfFixture, xlsxFixture } from "./file-extract/test-fixtures";
import {
  KNOWLEDGE_DOCUMENT_EXTENSIONS,
  KNOWLEDGE_FILE_EXTENSIONS,
  KNOWLEDGE_FILE_MAX_BYTES,
  extractText,
} from "./knowledge-extract";
import { KNOWLEDGE_TEXT_MAX_CHARS, KNOWLEDGE_TEXT_TRUNCATED } from "./knowledge-text";

const PLANTED = "QUENTLE-4402-PLANTED";

function pdfBytes(): Buffer {
  return Buffer.from(buildTextPdf(["Page one text here.", `Page two carries ${PLANTED} exactly once.`]));
}

async function docxBytes(paragraphs: readonly string[]): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: paragraphs.map((text) => new Paragraph({ children: [new TextRun({ text })] })),
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function codeOf(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  return (error as ApiError).code;
}

describe("extractText", () => {
  it("keeps plain text sources byte-for-byte", async () => {
    const text = await extractText("notes.txt", "text/plain", Buffer.from("hello world", "utf8"));
    expect(text).toBe("hello world");
  });

  it("accepts json, csv and markdown by extension even without a useful mime", async () => {
    const rows = await extractText("rows.csv", "application/octet-stream", Buffer.from("a,b\n1,2", "utf8"));
    expect(rows).toBe("a,b\n1,2");
    const json = await extractText("data.json", "application/json", Buffer.from('{"a":1}', "utf8"));
    expect(json).toBe('{"a":1}');
    const md = await extractText("readme.md", "application/octet-stream", Buffer.from("# Title", "utf8"));
    expect(md).toBe("# Title");
  });

  it("reads html as prose, by mime or by extension, and drops script and style bodies", async () => {
    const page =
      '<!doctype html><html><head><title>Probe</title><style>.x{color:red}</style>' +
      `<script>var token="${PLANTED}";</script></head><body><h1>Probe</h1>` +
      "<p>The Alder Point beacon flashes 77 times per minute.</p></body></html>";
    for (const [name, mime] of [
      ["page.html", "text/html"],
      ["page.htm", "application/octet-stream"],
      ["page", "text/html"],
    ] as const) {
      const text = await extractText(name, mime, Buffer.from(page, "utf8"));
      expect(text).toContain("The Alder Point beacon flashes 77 times per minute.");
      // Markup used to be indexed verbatim and served inside the trusted `## Retrieved sources`
      // block — a `<script>` body is exactly where text hides from a human reviewer.
      expect(text).not.toContain("<p>");
      expect(text).not.toContain("color:red");
      expect(text).not.toContain(PLANTED);
    }
  });

  it("still rejects binaries it cannot read", async () => {
    expect(await codeOf(extractText("photo.png", "image/png", Buffer.from([1, 2, 3])))).toBe(
      "unsupported_content_type",
    );
  });

  // The refusal is the only place the owner reads the list, so it has to be the list.
  it("names every format it takes in the refusal, converter formats included", async () => {
    const message = await extractText("photo.png", "image/png", Buffer.from([1, 2, 3])).then(
      () => "",
      (error: unknown) => (error instanceof ApiError ? error.message : ""),
    );
    for (const extension of KNOWLEDGE_FILE_EXTENSIONS) {
      expect(message, extension).toContain(extension);
    }
    for (const extension of KNOWLEDGE_DOCUMENT_EXTENSIONS) {
      expect(KNOWLEDGE_FILE_EXTENSIONS as readonly string[], extension).toContain(extension);
    }
  });

  it("routes a pdf by extension and keeps the page markers", async () => {
    const text = await extractText("report.pdf", "application/octet-stream", pdfBytes());
    expect(text).toContain(PLANTED);
    expect(text.indexOf("<!-- page 2 -->")).toBeLessThan(text.indexOf(PLANTED));
  });

  it("routes a pdf by mime when the filename has no extension", async () => {
    const text = await extractText("upload", "application/pdf", pdfBytes());
    expect(text).toContain(PLANTED);
  });

  it("routes a docx by extension and flattens paragraphs with blank lines", async () => {
    const bytes = await docxBytes(["First clause.", `Second clause with ${PLANTED}.`]);
    const text = await extractText("agreement.docx", "application/octet-stream", bytes);
    expect(text).toContain(PLANTED);
    expect(text).toBe(`First clause.\n\nSecond clause with ${PLANTED}.`);
  });

  it("routes a docx by mime", async () => {
    const bytes = await docxBytes(["Only clause."]);
    expect(await extractText("upload", DOCX_MIME, bytes)).toBe("Only clause.");
  });

  it("maps a scanned pdf to pdf_no_text_layer", async () => {
    const scanned = Buffer.from(buildTextPdf(["", ""]));
    expect(await codeOf(extractText("scan.pdf", "application/pdf", scanned))).toBe("pdf_no_text_layer");
  });

  it("explains the scanned-pdf failure in words the owner can act on", async () => {
    const scanned = Buffer.from(buildTextPdf([""]));
    const error = await extractText("scan.pdf", "application/pdf", scanned).catch((caught: unknown) => caught);
    expect((error as ApiError).message).toBe("This PDF has no text layer (scanned image). OCR is not supported yet.");
    expect((error as ApiError).status).toBe(400);
  });

  it("maps corrupt pdf bytes to pdf_invalid", async () => {
    expect(await codeOf(extractText("broken.pdf", "application/pdf", Buffer.from(buildGarbagePdf())))).toBe(
      "pdf_invalid",
    );
  });

  it("maps an oversized pdf to pdf_too_large", async () => {
    const big = Buffer.concat([pdfBytes(), Buffer.alloc(26 * 1024 * 1024)]);
    expect(await codeOf(extractText("big.pdf", "application/pdf", big))).toBe("pdf_too_large");
  });

  it("maps a spent pdf deadline to pdf_timeout", async () => {
    const code = await codeOf(extractText("slow.pdf", "application/pdf", pdfBytes(), { pdf: { timeoutMs: 1 } }));
    expect(code).toBe("pdf_timeout");
  });

  it("maps corrupt docx bytes to docx_invalid", async () => {
    expect(await codeOf(extractText("broken.docx", DOCX_MIME, Buffer.from("not a zip at all", "utf8")))).toBe(
      "docx_invalid",
    );
  });

  it("keeps the docx_invalid message free of parser detail", async () => {
    const error = await extractText("broken.docx", DOCX_MIME, Buffer.from("not a zip at all", "utf8")).catch(
      (caught: unknown) => caught,
    );
    expect((error as ApiError).message).toBe("This Word file could not be read (the file looks damaged).");
    expect((error as ApiError).message).not.toMatch(/zip|xmldom|JSZip/i);
  });

  it("maps an oversized docx to docx_too_large before it is parsed", async () => {
    const bytes = Buffer.alloc(KNOWLEDGE_FILE_MAX_BYTES + 1);
    expect(await codeOf(extractText("big.docx", DOCX_MIME, bytes))).toBe("docx_too_large");
  });

  it("rejects a zip that declares more inflated bytes than the cap", async () => {
    const bomb = Buffer.from(await buildZipBomb(900 * 1024 * 1024));
    expect(await codeOf(extractText("bomb.docx", DOCX_MIME, bomb))).toBe("docx_too_large");
  });

  it("still accepts a normal docx after the bomb pre-scan", async () => {
    const bytes = await docxBytes([`Ordinary clause with ${PLANTED}.`]);
    expect(await extractText("fine.docx", DOCX_MIME, bytes)).toBe(`Ordinary clause with ${PLANTED}.`);
  });

  it("maps a spent docx deadline to docx_timeout", async () => {
    const bytes = await docxBytes(["Only clause."]);
    const code = await codeOf(extractText("slow.docx", DOCX_MIME, bytes, { docx: { timeoutMs: 1 } }));
    expect(code).toBe("docx_timeout");
  });

  it("truncates an over-long extracted text instead of throwing", async () => {
    const long = "x".repeat(KNOWLEDGE_TEXT_MAX_CHARS + 5_000);
    const text = await extractText("huge.txt", "text/plain", Buffer.from(long, "utf8"));
    expect(text.length).toBeLessThan(long.length);
    expect(text.startsWith("x".repeat(1_000))).toBe(true);
    expect(text.endsWith(KNOWLEDGE_TEXT_TRUNCATED)).toBe(true);
  });

  it("caps docx text at the same limit the paste and URL paths use", async () => {
    const paragraph = "y".repeat(100_000);
    const bytes = await docxBytes(Array.from({ length: 25 }, () => paragraph));
    const text = await extractText("long.docx", DOCX_MIME, bytes);
    expect(text.length).toBeLessThanOrEqual(KNOWLEDGE_TEXT_MAX_CHARS + KNOWLEDGE_TEXT_TRUNCATED.length);
  });
});

describe("extractText — formats the converter adds", () => {
  it("indexes a .pptx deck by extension", async () => {
    const text = await extractText("deck.pptx", "application/octet-stream", Buffer.from(await pptxFixture()));
    expect(text).toContain("CEMARA-7781");
    expect(text).toContain("Pendapatan");
  });

  it("indexes a workbook, sheet headings and all", async () => {
    const text = await extractText("figures.xlsx", "application/octet-stream", Buffer.from(await xlsxFixture()));
    expect(text).toContain("Ringkasan");
    expect(text).toContain("Anggaran");
    expect(text).toContain("Pendapatan | 1000000 | 1250000");
  });

  it("indexes an .rtf memo", async () => {
    const text = await extractText("memo.rtf", "application/octet-stream", Buffer.from(rtfFixture()));
    expect(text).toContain("CEMARA-7781");
  });

  it("refuses a name that lies about the bytes", async () => {
    const code = await codeOf(extractText("deck.pptx", "application/octet-stream", Buffer.from("plain text", "utf8")));
    expect(code).toBe("document_format_mismatch");
  });

  it("leaves .docx on the parser the index was built with", async () => {
    // Same bytes, two readers: .docx must still come back as flattened paragraphs, not Markdown.
    const text = await extractText("laporan.docx", "application/octet-stream", Buffer.from(await docxFixture()));
    expect(text).not.toContain("# Laporan");
    expect(text).toContain("Laporan PT Cemara Sintetis");
  });
});
