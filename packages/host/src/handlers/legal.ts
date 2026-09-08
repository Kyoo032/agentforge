import { ApiError, type TenantContext } from "@agentforge/core";
import { BUILTIN_PLAYBOOKS, findPlaybook } from "@agentforge/core/legal";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { streamJob } from "../job-stream";
import { generateLegalRun } from "../legal-generate";
import {
  assertSafeInstructions,
  createMatterBodySchema,
  parseLegalBody,
  patchMatterBodySchema,
  runBodySchema,
} from "../legal/input";
import { LEGAL_FILE_MAX_BYTES } from "../legal/store-files";
import { legalStore, requireLegalMatter } from "../legal/store";

type TenantHandler = (tenant: TenantContext, request: HostRequest) => Promise<HostResult> | HostResult;

/** Shared shape of every legal handler: resolve the tenant, run, and map errors to JSON. */
async function withTenant(request: HostRequest, run: TenantHandler): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return await run(tenant, request);
  } catch (error) {
    return jsonError(error);
  }
}

function assertPlaybookExists(playbookId: string | null | undefined): void {
  if (playbookId && !findPlaybook(playbookId)) {
    throw new ApiError("invalid_request", `Unknown playbook "${playbookId}"`, 400);
  }
}

function assertPriorMatterExists(tenant: TenantContext, priorMatterId: string | null | undefined): void {
  if (priorMatterId && !legalStore().get(tenant, priorMatterId)) {
    throw new ApiError("invalid_request", "Prior matter not found in this workspace", 400);
  }
}

export function handlePostLegalMatters(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    const body = parseLegalBody(createMatterBodySchema, request.body);
    assertSafeInstructions(body.instructions);
    assertPlaybookExists(body.playbookId);
    assertPriorMatterExists(tenant, body.priorMatterId);
    return jsonOk(legalStore().create(tenant, body), 201);
  });
}

export function handleGetLegalMatters(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => jsonOk({ matters: legalStore().list(tenant) }));
}

export function handleGetLegalMatter(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => jsonOk(requireLegalMatter(tenant, request.params.matterId)));
}

export function handlePatchLegalMatter(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    const { roles, ...patch } = parseLegalBody(patchMatterBodySchema, request.body);
    assertSafeInstructions(patch.instructions);
    assertPlaybookExists(patch.playbookId);
    const store = legalStore();
    const matterId = request.params.matterId;
    requireLegalMatter(tenant, matterId);
    const updated = Object.values(patch).some((value) => value !== undefined)
      ? store.update(tenant, matterId, patch)
      : null;
    const withRoles = roles ? store.setRoles(tenant, matterId, roles) : null;
    return jsonOk(withRoles ?? updated ?? requireLegalMatter(tenant, matterId));
  });
}

export function handleDeleteLegalMatter(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    if (!legalStore().remove(tenant, request.params.matterId)) {
      throw new ApiError("not_found", "Matter not found", 404);
    }
    return jsonOk({ ok: true });
  });
}

/** Multipart, one file per request under the field "file". Form fields are not surfaced by the adapter. */
export function handlePostLegalMatterFile(request: HostRequest): Promise<HostResult> {
  return withTenant(request, async (tenant) => {
    const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
    if (!file) {
      throw new ApiError("invalid_request", 'Attach one .docx file under the field "file"', 400);
    }
    if (file.bytes.byteLength > LEGAL_FILE_MAX_BYTES) {
      throw new ApiError("invalid_request", "A file exceeds the 25 MB cap", 413);
    }
    const result = await legalStore().addFile(tenant, request.params.matterId, {
      filename: file.filename,
      bytes: file.bytes,
    });
    return jsonOk(result);
  });
}

export function handleDeleteLegalMatterFile(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) =>
    jsonOk(legalStore().removeFile(tenant, request.params.matterId, request.params.docId)),
  );
}

/** classify -> diff -> review -> missing -> interactions -> draft -> verify -> edit -> package, as job.* SSE events. */
export function handlePostLegalRunStream(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    const body = parseLegalBody(runBodySchema, request.body);
    const matterId = request.params.matterId;
    requireLegalMatter(tenant, matterId);
    return streamJob((emit, abortSignal) => generateLegalRun(tenant, matterId, body, emit, abortSignal), {
      abortSignal: request.abortSignal,
    });
  });
}

export function handleGetLegalRun(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    const run = legalStore().getRun(tenant, request.params.matterId, request.params.runId);
    if (!run) {
      throw new ApiError("not_found", "Run not found", 404);
    }
    return jsonOk(run);
  });
}

/** Built-in playbooks; Knowledge Base sources of type Playbook join this list later. */
export function handleGetLegalPlaybooks(request: HostRequest): Promise<HostResult> {
  return withTenant(request, () =>
    jsonOk({
      playbooks: BUILTIN_PLAYBOOKS.map((playbook) => ({
        id: playbook.id,
        title: playbook.title,
        contractType: playbook.contractType,
        itemCount: playbook.items.length,
      })),
    }),
  );
}
