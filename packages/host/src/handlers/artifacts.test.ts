/**
 * How the artifact file route hands bytes to a browser (docs/internal/web-security-spec.md A7, and
 * the hosted XSS audit).
 *
 * An artifact body is model-written text. On the hosted deployment it is served from the app's own
 * origin, so anything the browser is willing to *render* there runs with the app's cookies. This
 * suite pins the three things that make that impossible: the stored type is never echoed back unless
 * the artifact catalog knows it, the response is always an attachment with `nosniff`, and every
 * artifact body carries its own `Content-Security-Policy: sandbox` so a saved file opened later has
 * no origin to act on.
 */
import { describe, expect, it } from "vitest";
import { DOCX_MIME, XLSX_MIME } from "@agentforge/core/artifacts";
import { artifactStore } from "../artifacts";
import { getTenant } from "../tenant";
import type { HostRequest, HostResult } from "../types";
import { ARTIFACT_FILE_CSP, INERT_ARTIFACT_MIME, artifactFileDelivery, handleGetArtifactFile } from "./artifacts";

function request(artifactId: string): HostRequest {
  return {
    method: "GET",
    path: `/api/v1/artifacts/${artifactId}/file`,
    query: {},
    params: { artifactId },
    headers: {},
  };
}

async function saveArtifact(input: { title: string; mime: "text/markdown" | typeof DOCX_MIME; body: string }) {
  const tenant = await getTenant();
  return artifactStore().create(tenant, {
    mode: "research",
    kind: "dossier",
    title: input.title,
    mime: input.mime,
    body: input.body,
    meta: {},
  }).id;
}

function bytes(result: HostResult): Extract<HostResult, { type: "bytes" }> {
  if (result.type !== "bytes") {
    throw new Error(`expected bytes, got ${result.type}`);
  }
  return result;
}

describe("artifactFileDelivery", () => {
  it("keeps the stored type for a text artifact the catalog knows, with a charset", () => {
    expect(artifactFileDelivery("text/markdown", "notes.md").contentType).toBe("text/markdown; charset=utf-8");
    expect(artifactFileDelivery("application/json", "notes.json").contentType).toBe("application/json; charset=utf-8");
  });

  it("keeps the stored type for the two binary artifact types, without a charset", () => {
    expect(artifactFileDelivery(DOCX_MIME, "a.docx").contentType).toBe(DOCX_MIME);
    expect(artifactFileDelivery(XLSX_MIME, "a.xlsx").contentType).toBe(XLSX_MIME);
  });

  // The renderable half of the audit: a body the browser would execute must never come back with a
  // type that invites it to. These are not artifact types today; a future writer must not make them
  // one by accident.
  it("refuses to name a renderable type, whatever the row says", () => {
    for (const mime of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "image/png"]) {
      expect(artifactFileDelivery(mime, "x.bin").contentType).toBe(INERT_ARTIFACT_MIME);
    }
  });

  it("always answers as an attachment, never sniffed, and sandboxed", () => {
    const { headers } = artifactFileDelivery("text/markdown", "notes.md");
    expect(headers["Content-Disposition"]).toBe('attachment; filename="notes.md"');
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Content-Security-Policy"]).toBe(ARTIFACT_FILE_CSP);
    expect(ARTIFACT_FILE_CSP).toContain("sandbox");
  });

  // The filename is built from a model-written title. It reaches a response header, so a quote or a
  // newline in it must not be able to end the parameter or start a header of its own.
  it("strips quotes and control characters out of the filename parameter", () => {
    const { headers } = artifactFileDelivery("text/markdown", 'a"b\r\nX-Evil: 1\nc.md');
    expect(headers["Content-Disposition"]).toBe('attachment; filename="a b X-Evil: 1 c.md"');
  });
});

describe("handleGetArtifactFile", () => {
  it("serves a markdown artifact as an inert attachment", async () => {
    const id = await saveArtifact({ title: "Cash runway", mime: "text/markdown", body: "# Hi\n" });
    const result = bytes(await handleGetArtifactFile(request(id)));
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("text/markdown; charset=utf-8");
    expect(result.filename).toBe("cash-runway.md");
    expect(result.headers).toMatchObject({
      "Content-Disposition": 'attachment; filename="cash-runway.md"',
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": ARTIFACT_FILE_CSP,
    });
    expect(Buffer.from(result.bytes).toString("utf8")).toBe("# Hi\n");
  });

  it("serves a docx artifact with its own type and the same headers", async () => {
    const id = await saveArtifact({
      title: "Board memo",
      mime: DOCX_MIME,
      body: Buffer.from("zip-bytes").toString("base64"),
    });
    const result = bytes(await handleGetArtifactFile(request(id)));
    expect(result.contentType).toBe(DOCX_MIME);
    expect(result.filename).toBe("board-memo.docx");
    expect(result.headers?.["X-Content-Type-Options"]).toBe("nosniff");
    expect(result.headers?.["Content-Security-Policy"]).toBe(ARTIFACT_FILE_CSP);
  });

  it("answers an unknown id with the error envelope and no headers to speak of", async () => {
    const result = await handleGetArtifactFile(request("does-not-exist"));
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(404);
  });
});
