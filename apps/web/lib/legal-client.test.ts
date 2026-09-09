import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch, saveBlob, isElectron } = vi.hoisted(() => ({
  apiFetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
  saveBlob: vi.fn(),
  isElectron: vi.fn(() => false),
}));

vi.mock("./api-client", () => ({ apiFetch, isElectron }));
vi.mock("./artifacts-client", () => ({ saveBlob }));

import {
  LEGAL_DOCX_ONLY_MESSAGE,
  createLegalMatter,
  deleteLegalFile,
  deleteLegalMatter,
  downloadLegalArtifact,
  getLegalMatter,
  getLegalRun,
  legalArtifactFilePath,
  legalRunStreamPath,
  listLegalMatters,
  listLegalPlaybooks,
  parseLegalRunSummary,
  updateLegalMatter,
  uploadLegalFile,
  uploadLegalFiles,
} from "./legal-client";

const MATTER = {
  id: "m1",
  workspaceId: "w1",
  title: "Meridian credit agreement",
  createdAt: 1,
  updatedAt: 2,
  side: { role: "borrower", party: "Meridian", counterparty: "the Lenders" },
  workType: "review",
  deliverables: ["issues-memo", "redline"],
  instructions: "",
  playbookId: null,
  author: "",
  addressee: "",
  firm: "",
  docs: [],
  priorMatterId: null,
  lastRunId: null,
};

const CARD = {
  id: "S1",
  name: "draft.docx",
  path: "draft.docx",
  mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bytes: 10,
  sha256: "abc",
  role: "context",
  status: "read",
  paragraphs: 3,
  words: 40,
  insertions: 0,
  deletions: 0,
  definedTerms: 1,
  preview: "",
};

const FINDING = {
  id: "F1",
  clause: "§7.2(b)",
  kind: "adverse",
  quote: "shall indemnify",
  quoteAnchor: "¶12",
  title: "Indemnity uncapped",
  why: "Uncapped.",
  severity: "high",
  negotiability: "preferred",
  proposedText: "capped",
  basis: [{ doc: "S2", ref: "§11" }],
  reservedFor: null,
  checklist: [],
  round: 1,
};

const VERIFY = {
  round: 1,
  codeChecks: [{ code: "quotes-verbatim", passed: 3, failed: 0, failures: [] }],
  checklist: [],
  concessions: [],
  documentsSkipped: [],
  openForHuman: [],
  ok: true,
};

const MANIFEST = {
  harness: "agentforge-legal/1",
  matterId: "m1",
  createdAt: "2026-09-08T00:00:00Z",
  side: MATTER.side,
  workType: "review",
  deliverables: ["issues-memo"],
  playbookId: null,
  docs: [CARD],
  models: { drafting: "gpt", verifier: "claude" },
  rounds: [],
  maxRounds: 3,
  findingsCount: 1,
  status: "complete",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lastCall(): { url: string; init: RequestInit } {
  const call = apiFetch.mock.calls.at(-1);
  if (!call) {
    throw new Error("apiFetch was not called");
  }
  return { url: call[0], init: call[1] ?? {} };
}

beforeEach(() => {
  apiFetch.mockReset();
  saveBlob.mockReset();
  isElectron.mockReturnValue(false);
});

describe("legal-client paths", () => {
  it("builds the run stream and artifact file paths", () => {
    expect(legalRunStreamPath("m 1")).toBe("/api/v1/legal/matters/m%201/run/stream");
    expect(legalArtifactFilePath("a/1")).toBe("/api/v1/artifacts/a%2F1/file");
  });
});

describe("matters", () => {
  it("creates a matter with a JSON body and validates the record", async () => {
    apiFetch.mockResolvedValue(json(MATTER, 201));
    const matter = await createLegalMatter({
      title: MATTER.title,
      side: MATTER.side,
      workType: "review",
      deliverables: ["issues-memo", "redline"],
      priorMatterId: "m0",
    });
    const { url, init } = lastCall();
    expect(url).toBe("/api/v1/legal/matters");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ title: MATTER.title, priorMatterId: "m0" });
    expect(matter.id).toBe("m1");
    expect(matter.docs).toEqual([]);
  });

  it("rejects a malformed matter record with a friendly message", async () => {
    apiFetch.mockResolvedValue(json({ id: "m1" }));
    await expect(getLegalMatter("m1")).rejects.toThrow(/unexpected matter/);
  });

  it("surfaces the host error message on failure", async () => {
    apiFetch.mockResolvedValue(json({ error: { code: "not_found", message: "No such matter." } }, 404));
    await expect(getLegalMatter("nope")).rejects.toThrow("No such matter.");
  });

  it("lists matters and drops rows that do not parse", async () => {
    apiFetch.mockResolvedValue(json({ matters: [MATTER, { id: "broken" }] }));
    const list = await listLegalMatters();
    expect(lastCall().url).toBe("/api/v1/legal/matters");
    expect(list.map((m) => m.id)).toEqual(["m1"]);
  });

  it("patches roles and fields with PATCH", async () => {
    apiFetch.mockResolvedValue(json({ ...MATTER, docs: [{ ...CARD, role: "executed" }] }));
    const matter = await updateLegalMatter("m1", { roles: [{ id: "S1", role: "executed" }], title: "T" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/v1/legal/matters/m1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ roles: [{ id: "S1", role: "executed" }], title: "T" });
    expect(matter.docs[0]?.role).toBe("executed");
  });

  it("deletes a matter and a file", async () => {
    apiFetch.mockResolvedValueOnce(json({ ok: true }));
    await deleteLegalMatter("m1");
    expect(lastCall()).toMatchObject({ url: "/api/v1/legal/matters/m1", init: { method: "DELETE" } });
    apiFetch.mockResolvedValueOnce(json(MATTER));
    await deleteLegalFile("m1", "S1");
    expect(lastCall()).toMatchObject({ url: "/api/v1/legal/matters/m1/files/S1", init: { method: "DELETE" } });
  });
});

describe("uploads", () => {
  it("posts one multipart request per file under the field name 'file'", async () => {
    apiFetch.mockResolvedValue(json({ matter: { ...MATTER, docs: [CARD] }, card: CARD }));
    const file = new File(["PK"], "draft.docx");
    const result = await uploadLegalFile("m1", file);
    const { url, init } = lastCall();
    expect(url).toBe("/api/v1/legal/matters/m1/files");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("draft.docx");
    expect(result.card.id).toBe("S1");
    expect(result.matter.docs).toHaveLength(1);
  });

  it("rejects non-docx files before the network with the host's message", async () => {
    await expect(uploadLegalFile("m1", new File(["x"], "scan.pdf"))).rejects.toThrow(LEGAL_DOCX_ONLY_MESSAGE);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("uploads sequentially, reports progress, and stops at the first failure", async () => {
    apiFetch
      .mockResolvedValueOnce(json({ matter: { ...MATTER, docs: [CARD] }, card: CARD }))
      .mockResolvedValueOnce(json({ error: { code: "conflict", message: "Duplicate document." } }, 409));
    const seen: string[] = [];
    const files = [new File(["a"], "a.docx"), new File(["b"], "b.docx"), new File(["c"], "c.docx")];
    await expect(
      uploadLegalFiles("m1", files, (p) => {
        seen.push(`${p.file.name}:${p.status}:${p.index + 1}/${p.total}`);
      }),
    ).rejects.toThrow("Duplicate document.");
    expect(seen).toEqual(["a.docx:uploading:1/3", "a.docx:done:1/3", "b.docx:uploading:2/3", "b.docx:failed:2/3"]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});

describe("runs and playbooks", () => {
  it("fetches a run record and normalises it to the summary shape", async () => {
    apiFetch.mockResolvedValue(
      json({
        id: "r1",
        matterId: "m1",
        startedAt: 1,
        finishedAt: 2,
        manifest: MANIFEST,
        findings: [FINDING],
        verify: VERIFY,
        artifacts: [{ kind: "issues-memo", artifactId: "a1", filename: "memo.docx" }],
        error: null,
      }),
    );
    const run = await getLegalRun("m1", "r1");
    expect(lastCall().url).toBe("/api/v1/legal/matters/m1/runs/r1");
    expect(run.runId).toBe("r1");
    expect(run.findings[0]?.clause).toBe("§7.2(b)");
    expect(run.verify?.ok).toBe(true);
    expect(run.artifacts[0]?.kind).toBe("issues-memo");
  });

  it("validates the job.done payload", () => {
    const summary = parseLegalRunSummary({ runId: "r1", manifest: MANIFEST, findings: [FINDING], verify: null });
    expect(summary.artifacts).toEqual([]);
    expect(summary.manifest.models.verifier).toBe("claude");
    expect(() => parseLegalRunSummary({ runId: "r1" })).toThrow(/unexpected run result/);
  });

  it("lists playbooks", async () => {
    apiFetch.mockResolvedValue(
      json({ playbooks: [{ id: "generic-contract", title: "Generic", contractType: "any", itemCount: 12 }] }),
    );
    const list = await listLegalPlaybooks();
    expect(lastCall().url).toBe("/api/v1/legal/playbooks");
    expect(list[0]?.itemCount).toBe(12);
  });
});

describe("downloads", () => {
  it("saves the bytes with the Content-Disposition filename in the browser", async () => {
    apiFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="redline.docx"' },
      }),
    );
    await downloadLegalArtifact({ kind: "redline", artifactId: "a2", filename: "fallback.docx" });
    expect(lastCall().url).toBe("/api/v1/artifacts/a2/file");
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "redline.docx");
  });

  it("leaves saving to the native dialog on desktop", async () => {
    isElectron.mockReturnValue(true);
    apiFetch.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
    await downloadLegalArtifact({ kind: "issues-memo", artifactId: "a3", filename: "memo.docx" });
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
