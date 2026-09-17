/**
 * The picker and the host, pinned to each other.
 *
 * The renderer must not import `packages/host`, so the only honest check is to read the host's own
 * `knowledge-extract.ts` and compare the two lists. A format the host learns to read and the picker
 * does not offer is a format the owner cannot upload, which is exactly how six types stood against
 * the host's sixteen.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import enKnowledge from "../locales/en/knowledge.json";
import idKnowledge from "../locales/id/knowledge.json";
import {
  KNOWLEDGE_UPLOAD_ACCEPT,
  KNOWLEDGE_UPLOAD_EXTENSIONS,
  KNOWLEDGE_UPLOAD_FORMATS,
  knowledgeUploadAllowed,
} from "./knowledge-upload";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const hostSource = readFileSync(join(repo, "packages", "host", "src", "knowledge-extract.ts"), "utf8");
const page = readFileSync(join(repo, "apps", "web", "components", "knowledge-page.tsx"), "utf8");

/** The extensions `sourceKind` matches by name, one per `lower.endsWith(".x")`. */
function endsWithExtensions(source: string): string[] {
  return [...source.matchAll(/lower\.endsWith\("(\.[a-z0-9]+)"\)/g)].map((match) => match[1] ?? "");
}

/** The converter's own list, read out of the `KNOWLEDGE_DOCUMENT_EXTENSIONS` array literal. */
function documentExtensions(source: string): string[] {
  const block = /KNOWLEDGE_DOCUMENT_EXTENSIONS\s*=\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/"(\.[a-z0-9]+)"/g)].map((match) => match[1] ?? "");
}

describe("knowledge upload accept list", () => {
  it("found the host's lists at all, so a rename fails loudly instead of passing empty", () => {
    expect(endsWithExtensions(hostSource).length).toBeGreaterThan(4);
    expect(documentExtensions(hostSource).length).toBeGreaterThan(4);
  });

  it("offers every format the host indexes", () => {
    for (const extension of [...endsWithExtensions(hostSource), ...documentExtensions(hostSource)]) {
      expect(KNOWLEDGE_UPLOAD_EXTENSIONS as readonly string[], extension).toContain(extension);
      expect(knowledgeUploadAllowed(`report${extension.toUpperCase()}`), extension).toBe(true);
    }
  });

  it("offers nothing the host would refuse", () => {
    const host = new Set([...endsWithExtensions(hostSource), ...documentExtensions(hostSource)]);
    for (const extension of KNOWLEDGE_UPLOAD_EXTENSIONS) {
      expect(host.has(extension), extension).toBe(true);
    }
  });

  it("refuses a name that is not one of them", () => {
    expect(knowledgeUploadAllowed("photo.png")).toBe(false);
    expect(knowledgeUploadAllowed("notes.txt.exe")).toBe(false);
  });
});

describe("the picker and its help copy read from that list", () => {
  it("wires the input's accept to the constant instead of a hand-written string", () => {
    expect(page).toContain("accept={KNOWLEDGE_UPLOAD_ACCEPT}");
    expect(KNOWLEDGE_UPLOAD_ACCEPT.split(",")).toContain(".epub");
  });

  it("names the formats from the same list, in both languages", () => {
    const hint = (catalog: Record<string, unknown>) =>
      (catalog.sources as Record<string, string> | undefined)?.uploadHint ?? "";
    expect(hint(enKnowledge as Record<string, unknown>)).toContain("{formats}");
    expect(hint(idKnowledge as Record<string, unknown>)).toContain("{formats}");
    expect(KNOWLEDGE_UPLOAD_FORMATS).toContain(".pptx");
  });
});
