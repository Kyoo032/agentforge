/**
 * The privacy guarantee, asserted rather than asserted-in-prose.
 *
 * Financial statements are the most private thing this app touches, so "it all stays on the machine"
 * has to be a test, not a comment. Every socket door Node opens is replaced by a stub that throws,
 * and every fixture format is converted through them — including the scanned PDF, whose refusal is
 * the one path a converter could plausibly decide to phone home from.
 */
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileExtractError, extractFile } from "./index";
import {
  csvFixture,
  docxFixture,
  pdfFixture,
  pptxFixture,
  rtfFixture,
  scannedPdfFixture,
  xlsxFixture,
} from "./test-fixtures";

type Door = { readonly owner: Record<string, unknown>; readonly name: string };

const DOORS: ReadonlyArray<Door> = [
  { owner: globalThis as unknown as Record<string, unknown>, name: "fetch" },
  { owner: http as unknown as Record<string, unknown>, name: "request" },
  { owner: http as unknown as Record<string, unknown>, name: "get" },
  { owner: https as unknown as Record<string, unknown>, name: "request" },
  { owner: https as unknown as Record<string, unknown>, name: "get" },
  { owner: net as unknown as Record<string, unknown>, name: "connect" },
  { owner: net as unknown as Record<string, unknown>, name: "createConnection" },
  { owner: tls as unknown as Record<string, unknown>, name: "connect" },
  { owner: dns as unknown as Record<string, unknown>, name: "lookup" },
];

const reached: string[] = [];
const originals = new Map<Door, unknown>();

beforeEach(() => {
  reached.length = 0;
  for (const door of DOORS) {
    originals.set(door, door.owner[door.name]);
    door.owner[door.name] = (...args: unknown[]) => {
      reached.push(`${door.name}(${String(args[0]).slice(0, 80)})`);
      throw new Error(`file-extract reached the network through ${door.name}`);
    };
  }
});

afterEach(() => {
  for (const door of DOORS) {
    door.owner[door.name] = originals.get(door);
  }
  originals.clear();
});

/**
 * The env the converter would read if it were ever asked to send a document away. Assembled from
 * parts on purpose: `no-hosted-ocr.test.ts` fails any source file that spells these out, and this
 * file should not be the exception that makes the guard weaker than it reads.
 */
const FIRECRAWL_VARS = ["KEY", "URL"].map((suffix) => ["FIRECRAWL", "API", suffix].join("_"));

/** The rejection, narrowed. `.catch(x => x as FileExtractError)` widens to include the success type. */
async function failureOf(work: Promise<unknown>): Promise<FileExtractError> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FileExtractError);
  return error as FileExtractError;
}

describe("file-extract stays on this machine", () => {
  it("opens no socket while converting any format, scans included", async () => {
    const fixtures: ReadonlyArray<readonly [string, Uint8Array]> = [
      ["figures.csv", csvFixture()],
      ["figures.xlsx", await xlsxFixture()],
      ["laporan.docx", await docxFixture()],
      ["deck.pptx", await pptxFixture()],
      ["memo.rtf", rtfFixture()],
      ["report.pdf", pdfFixture()],
    ];
    for (const [filename, bytes] of fixtures) {
      const result = await extractFile({ bytes, filename });
      expect(result.markdown.length).toBeGreaterThan(0);
    }
    // The NeedsOcr path: the one document the converter could have been tempted to upload.
    const refusal = await failureOf(extractFile({ bytes: scannedPdfFixture(), filename: "scan.pdf" }));
    expect(refusal.code).toBe("needs_ocr");
    expect(reached).toEqual([]);
  });

  it("never reads a Firecrawl variable, so a key in the environment changes nothing", async () => {
    const before = FIRECRAWL_VARS.map((name) => process.env[name]);
    expect(FIRECRAWL_VARS).toHaveLength(2);
    for (const name of FIRECRAWL_VARS) {
      process.env[name] = "set-by-the-test-and-must-be-ignored";
    }
    try {
      const withKey = await extractFile({ bytes: csvFixture(), filename: "figures.csv" });
      expect(withKey.tables).toHaveLength(1);
      const stillRefused = await failureOf(extractFile({ bytes: scannedPdfFixture(), filename: "scan.pdf" }));
      // With hosted OCR reachable this would have succeeded. It is not reachable.
      expect(stillRefused.code).toBe("needs_ocr");
      expect(reached).toEqual([]);
    } finally {
      FIRECRAWL_VARS.forEach((name, index) => {
        const value = before[index];
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      });
    }
  });
});
