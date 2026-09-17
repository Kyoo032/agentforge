import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import { ApiError, type TenantContext } from "@agentforge/core";
import { LEGAL_CAPS, legalOutputCopy, type LegalManifest, type MatterDocCard } from "@agentforge/core/legal";
import { listSources } from "../knowledge";
import { upsertWorkSource } from "../knowledge-ingest";
import { artifactWorkCard } from "../work-cards";
import { DOCX_MIME, LEGAL_MATTER_MAX_BYTES, UNSUPPORTED_FILE_MESSAGE } from "./store-files";
import { localeForRun } from "../run-context";
import { type CreateMatterInput, type LegalRunRecord, type LegalStore, createLegalStore } from "./store";

const tenant: TenantContext = { organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };
const otherDesk: TenantContext = { ...tenant, workspaceId: "ws-2" };

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../core/src/docx/fixtures");
const ACA = new Uint8Array(readFileSync(join(FIXTURES, "lender-initial-aca-draft.docx")));
const TERM_SHEET = new Uint8Array(readFileSync(join(FIXTURES, "original-term-sheet.docx")));

const INPUT: CreateMatterInput = {
  title: "Project Aurora ACA",
  side: { role: "borrower", party: "Aurora Holdings", counterparty: "the Lenders" },
  workType: "review",
  deliverables: ["issues-memo", "redline"],
};

function fakeCard(n: number, bytes: number): MatterDocCard {
  return {
    id: `S${n}`,
    name: `doc-${n}.docx`,
    path: `files/S${n}.docx`,
    mime: DOCX_MIME,
    bytes,
    sha256: `sha-${n}`,
    role: "context",
    status: "read",
    paragraphs: 1,
    words: 1,
    insertions: 0,
    deletions: 0,
    definedTerms: 0,
    preview: "",
  };
}

function manifestFor(matterId: string): LegalManifest {
  return {
    harness: "agentforge-legal/1",
    matterId,
    createdAt: new Date(0).toISOString(),
    side: INPUT.side,
    workType: "review",
    deliverables: ["issues-memo"],
    playbookId: null,
    docs: [],
    models: { drafting: "m", verifier: "v" },
    rounds: [],
    maxRounds: 1,
    findingsCount: 0,
    status: "complete",
  };
}

describe("legal store", () => {
  let dir: string;
  let store: LegalStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-legal-"));
    store = createLegalStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Overwrite the persisted card list to simulate a full matter without parsing 60 real files. */
  function seedCards(matterId: string, docs: MatterDocCard[]): void {
    const file = join(dir, tenant.workspaceId, matterId, "matter.json");
    const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...record, docs }));
  }

  it("creates, lists newest first, gets, and removes matters within a workspace", () => {
    const first = store.create(tenant, INPUT);
    expect(first).toMatchObject({
      title: INPUT.title,
      workspaceId: "ws-1",
      docs: [],
      instructions: "",
      playbookId: null,
      author: "",
      priorMatterId: null,
      lastRunId: null,
    });
    const second = store.create(tenant, { ...INPUT, title: "  Second  ", createdAt: 0 } as CreateMatterInput);
    // Same millisecond is possible; stabilise ordering by nudging the first record back in time.
    const file = join(dir, tenant.workspaceId, first.id, "matter.json");
    const record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...record, createdAt: first.createdAt - 1000 }));

    expect(second.title).toBe("Second");
    expect(store.list(tenant).map((matter) => matter.id)).toEqual([second.id, first.id]);
    expect(store.get(tenant, first.id)?.title).toBe(INPUT.title);
    expect(store.remove(tenant, first.id)).toBe(true);
    expect(store.remove(tenant, first.id)).toBe(false);
    expect(store.get(tenant, first.id)).toBeNull();
    expect(existsSync(join(dir, tenant.workspaceId, first.id))).toBe(false);
    expect(() => store.create(tenant, { ...INPUT, title: "   " })).toThrow(/title is required/);
    expect(() => store.get(tenant, "../escape")).toThrow(/malformed/);
  });

  it("ingests a docx, caches the reader output, and rejects duplicates and non-docx files", async () => {
    const matter = store.create(tenant, INPUT);
    const { matter: next, card } = await store.addFile(tenant, matter.id, {
      filename: "ACA draft (v1).docx",
      bytes: ACA,
    });
    expect(card).toMatchObject({
      id: "S1",
      name: "ACA_draft_v1_.docx",
      role: "context",
      status: "read",
      mime: DOCX_MIME,
    });
    expect(card.paragraphs).toBeGreaterThan(0);
    expect(card.words).toBeGreaterThan(0);
    expect(card.bytes).toBe(ACA.byteLength);
    expect(card.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(card.preview.length).toBeGreaterThan(0);
    expect(card.preview.length).toBeLessThanOrEqual(LEGAL_CAPS.previewChars);
    expect(next.docs).toEqual([card]);
    expect(matter.docs).toEqual([]);
    expect(existsSync(join(dir, tenant.workspaceId, matter.id, "parsed", "S1.json"))).toBe(true);
    expect(existsSync(join(dir, tenant.workspaceId, matter.id, "files", "S1.docx"))).toBe(true);

    const doc = await store.readDoc(tenant, matter.id, "S1");
    expect(doc?.stats.paragraphs).toBe(card.paragraphs);
    expect(store.readBytes(tenant, matter.id, "S1")?.byteLength).toBe(ACA.byteLength);
    expect(await store.readDoc(tenant, matter.id, "S9")).toBeNull();

    await expect(store.addFile(tenant, matter.id, { filename: "again.docx", bytes: ACA })).rejects.toMatchObject({
      code: "conflict",
      status: 409,
    });
    await expect(
      store.addFile(tenant, matter.id, { filename: "notes.txt", bytes: Buffer.from("plain text, not a docx") }),
    ).rejects.toMatchObject({
      code: "unsupported_content_type",
      status: 400,
      message: legalOutputCopy(localeForRun()).unsupportedFile,
    });
    expect(UNSUPPORTED_FILE_MESSAGE).toBe(legalOutputCopy("en").unsupportedFile);
    expect(store.get(tenant, matter.id)?.docs).toHaveLength(1);
    expect(existsSync(join(dir, tenant.workspaceId, matter.id, "files", "S2.docx"))).toBe(false);

    const second = await store.addFile(tenant, matter.id, { filename: "term-sheet.docx", bytes: TERM_SHEET });
    expect(second.card.id).toBe("S2");
    const afterRemove = store.removeFile(tenant, matter.id, "S1");
    expect(afterRemove.docs.map((entry) => entry.id)).toEqual(["S2"]);
    expect(existsSync(join(dir, tenant.workspaceId, matter.id, "files", "S1.docx"))).toBe(false);
    expect(() => store.removeFile(tenant, matter.id, "S1")).toThrow(ApiError);
    // Ids never reuse a number that was handed out before.
    const third = await store.addFile(tenant, matter.id, { filename: "aca.docx", bytes: ACA });
    expect(third.card.id).toBe("S3");
  });

  it("enforces the file count, per-file, and per-matter caps", async () => {
    const matter = store.create(tenant, INPUT);
    await expect(
      store.addFile(tenant, matter.id, { filename: "big.docx", bytes: new Uint8Array(25 * 1024 * 1024 + 1) }),
    ).rejects.toMatchObject({ status: 413, message: expect.stringMatching(/25 MB/) });
    await expect(
      store.addFile(tenant, matter.id, { filename: "empty.docx", bytes: new Uint8Array(0) }),
    ).rejects.toThrow(/empty/);

    seedCards(matter.id, [fakeCard(1, LEGAL_MATTER_MAX_BYTES - 10)]);
    await expect(store.addFile(tenant, matter.id, { filename: "aca.docx", bytes: ACA })).rejects.toMatchObject({
      status: 413,
      message: expect.stringMatching(/100 MB/),
    });

    seedCards(
      matter.id,
      Array.from({ length: LEGAL_CAPS.maxFiles }, (_, index) => fakeCard(index + 1, 10)),
    );
    await expect(store.addFile(tenant, matter.id, { filename: "aca.docx", bytes: ACA })).rejects.toMatchObject({
      status: 413,
      message: expect.stringMatching(/at most 60 files/),
    });
  });

  it("sets roles and updates fields without mutating the previous record", async () => {
    const created = store.create(tenant, INPUT);
    const { matter } = await store.addFile(tenant, created.id, { filename: "aca.docx", bytes: ACA });
    const withRoles = store.setRoles(tenant, created.id, [{ id: "S1", role: "counterparty-draft" }]);
    expect(withRoles.docs[0]?.role).toBe("counterparty-draft");
    expect(matter.docs[0]?.role).toBe("context");
    expect(store.get(tenant, created.id)?.docs[0]?.role).toBe("counterparty-draft");
    expect(() => store.setRoles(tenant, created.id, [{ id: "S7", role: "executed" }])).toThrow(/Document not found/);

    const updated = store.update(tenant, created.id, {
      title: "Renamed",
      deliverables: ["red-flags"],
      instructions: "Reserve §7.2 for the partner.",
      author: undefined,
    });
    expect(updated).toMatchObject({ title: "Renamed", deliverables: ["red-flags"], author: "" });
    expect(updated.instructions).toBe("Reserve §7.2 for the partner.");
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    expect(withRoles.title).toBe(INPUT.title);
    expect(() => store.update(tenant, created.id, { title: " " })).toThrow(/title is required/);
    expect(() => store.update(tenant, "missing", { title: "x" })).toThrow(/Matter not found/);
  });

  it("saves and reads runs, recording the last run on the matter", () => {
    const matter = store.create(tenant, INPUT);
    const run: LegalRunRecord = {
      id: "run-1",
      matterId: matter.id,
      startedAt: 1,
      finishedAt: 2,
      manifest: manifestFor(matter.id),
      findings: [],
      verify: null,
      artifacts: [{ kind: "issues-memo", artifactId: "a1", filename: "memo.docx" }],
      error: null,
    };
    expect(store.getRun(tenant, matter.id, "run-1")).toBeNull();
    store.saveRun(tenant, matter.id, run);
    expect(store.getRun(tenant, matter.id, "run-1")).toEqual(run);
    expect(store.get(tenant, matter.id)?.lastRunId).toBe("run-1");
    expect(() => store.saveRun(tenant, matter.id, { ...run, matterId: "other" })).toThrow(/does not belong/);
    expect(() => store.saveRun(tenant, matter.id, { ...run, id: "../x" })).toThrow(/malformed/);
    expect(store.getRun(tenant, matter.id, "nope")).toBeNull();
  });

  it("isolates workspaces: another desk cannot see, change, or delete a matter", async () => {
    const matter = store.create(tenant, INPUT);
    await store.addFile(tenant, matter.id, { filename: "aca.docx", bytes: ACA });
    expect(store.list(otherDesk)).toEqual([]);
    expect(store.get(otherDesk, matter.id)).toBeNull();
    expect(store.remove(otherDesk, matter.id)).toBe(false);
    expect(store.readBytes(otherDesk, matter.id, "S1")).toBeNull();
    expect(await store.readDoc(otherDesk, matter.id, "S1")).toBeNull();
    expect(store.getRun(otherDesk, matter.id, "run-1")).toBeNull();
    await expect(store.addFile(otherDesk, matter.id, { filename: "aca.docx", bytes: ACA })).rejects.toMatchObject({
      status: 404,
    });
    expect(() => store.setRoles(otherDesk, matter.id, [{ id: "S1", role: "executed" }])).toThrow(/Matter not found/);
    expect(() => store.update(otherDesk, matter.id, { title: "x" })).toThrow(/Matter not found/);
    expect(store.get(tenant, matter.id)?.docs).toHaveLength(1);
  });
});

/**
 * `remove` used to drop the matter directory and stop. The deliverables it created are artifacts,
 * and the matter's Knowledge card hangs off one of them, so a matter the owner believed they had
 * deleted kept feeding its red-flags text into every later Chat turn in that workspace.
 */
describe("legal matter delete reaches its artifacts and its card", () => {
  const desk: TenantContext = {
    organizationId: "org-legal-cascade",
    workspaceId: `ws-legal-${crypto.randomUUID()}`,
    userId: "local",
    role: "owner",
  };
  let dir: string;
  let store: LegalStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-legal-cascade-"));
    store = createLegalStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function seedArtifact(id: string, meta: Record<string, unknown>): void {
    sql
      .prepare(
        `INSERT INTO artifacts (id, workspace_id, mode, kind, title, mime, body, meta, size_bytes, created_at, updated_at)
         VALUES (?, ?, 'legal', 'red-flags', 'Red flags', 'text/markdown', 'body', ?, 4, ?, ?)`,
      )
      .run(id, desk.workspaceId, JSON.stringify(meta), Date.now(), Date.now());
  }

  it("removes the matter's deliverables, its manifest, and its knowledge card", async () => {
    const matter = store.create(desk, INPUT);
    const redFlags = crypto.randomUUID();
    const manifest = crypto.randomUUID();
    const unrelated = crypto.randomUUID();
    seedArtifact(redFlags, { matterId: matter.id, deliverable: "red-flags" });
    seedArtifact(manifest, { matterId: matter.id });
    seedArtifact(unrelated, { matterId: crypto.randomUUID() });
    await upsertWorkSource(
      desk,
      artifactWorkCard({
        type: "Legal",
        artifactId: redFlags,
        title: matter.title,
        markdown: "Clause 12 shifts termination risk to the borrower.",
      }),
    );
    expect(listSources(desk)).toHaveLength(1);

    expect(store.remove(desk, matter.id)).toBe(true);
    const left = sql.prepare("SELECT id FROM artifacts WHERE workspace_id = ?").all(desk.workspaceId) as Array<{
      id: string;
    }>;
    expect(left.map((row) => row.id)).toEqual([unrelated]);
    expect(listSources(desk)).toHaveLength(0);
  });
});
