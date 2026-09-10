import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ApiError, TenantContext } from "@agentforge/core";
import { buildGarbagePdf, buildTextPdf } from "@agentforge/core/pdf/test-fixtures";
import { addFileSource, listSources } from "./knowledge";

function tenant(): TenantContext {
  return {
    organizationId: "org-file-source-test",
    workspaceId: `ws-file-${crypto.randomUUID()}`,
    userId: "user-file-source-test",
    role: "owner",
  };
}

describe("addFileSource parse failures", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let previousMedia: string | undefined;
  let scratch: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    previousMedia = process.env.MEDIA_ROOT;
    scratch = mkdtempSync(join(tmpdir(), "af-knowledge-file-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = scratch;
    process.env.MEDIA_ROOT = join(scratch, "media");
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    restore("MEDIA_ROOT", previousMedia);
    rmSync(scratch, { recursive: true, force: true });
  });

  it("records a Failed source with the reason when a PDF has no text layer", async () => {
    const ctx = tenant();
    const source = await addFileSource(ctx, {
      filename: "scanned.pdf",
      mime: "application/pdf",
      bytes: buildTextPdf([""]),
    });
    expect(source.status).toBe("Failed");
    expect(source.chunks).toBe(0);
    expect(source.error).toMatch(/^pdf_no_text_layer: /);
    const listed = await listSources(ctx);
    expect(listed.map((item) => item.id)).toContain(source.id);
  });

  it("records a Failed source when the PDF bytes are damaged", async () => {
    const source = await addFileSource(tenant(), {
      filename: "broken.pdf",
      mime: "application/pdf",
      bytes: buildGarbagePdf(),
    });
    expect(source.status).toBe("Failed");
    expect(source.error).toMatch(/^pdf_invalid: /);
  });

  it("still indexes a text-layer PDF", async () => {
    const source = await addFileSource(tenant(), {
      filename: "notes.pdf",
      mime: "application/pdf",
      bytes: buildTextPdf(["The verification token is ZEBRA-KUMQUAT-4471."]),
    });
    expect(source.status).toBe("Indexed");
    expect(source.chunks).toBeGreaterThan(0);
  });

  it("keeps the 400 for unsupported types instead of a Failed row", async () => {
    await expect(
      addFileSource(tenant(), { filename: "clip.mp4", mime: "video/mp4", bytes: new Uint8Array([0, 1, 2]) }),
    ).rejects.toMatchObject({ code: "unsupported_content_type", status: 400 } satisfies Partial<ApiError>);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
