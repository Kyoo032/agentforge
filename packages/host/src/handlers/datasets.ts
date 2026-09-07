import { ApiError } from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { DATASET_MAX_BYTES, datasetStore, requireDataset, type LoadedDataset } from "../datasets";

const PREVIEW_ROWS = 100;

function readPastedDataset(body: unknown): { name: string; text: string } {
  const record = (body ?? {}) as { name?: unknown; text?: unknown; csv?: unknown };
  const text = typeof record.text === "string" ? record.text : typeof record.csv === "string" ? record.csv : "";
  if (!text.trim()) {
    throw new ApiError("invalid_request", "file or text is required", 400);
  }
  return { name: typeof record.name === "string" ? record.name : "Pasted table", text };
}

export function datasetPayload(dataset: LoadedDataset) {
  const { table, typed: _typed, profile, db: _db, runner: _runner, ...summary } = dataset;
  return {
    ...summary,
    profile,
    preview: { columns: table.headers, rows: table.rows.slice(0, PREVIEW_ROWS), total: table.rows.length },
  };
}

export async function handlePostDatasets(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
    if (file) {
      if (file.bytes.byteLength > DATASET_MAX_BYTES) {
        throw new ApiError("invalid_request", "Dataset exceeds the 25 MB cap", 413);
      }
      // Multipart form fields are not surfaced by the HTTP adapter; the filename is the dataset name.
      return jsonOk(
        datasetPayload(
          datasetStore().create(tenant, { name: file.filename, filename: file.filename, bytes: file.bytes }),
        ),
        201,
      );
    }
    const pasted = readPastedDataset(request.body);
    return jsonOk(
      datasetPayload(
        datasetStore().create(tenant, {
          name: pasted.name,
          filename: "pasted.csv",
          bytes: Buffer.from(pasted.text, "utf8"),
        }),
      ),
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetDatasets(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk({ items: datasetStore().list(tenant) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetDataset(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return jsonOk(datasetPayload(requireDataset(tenant, request.params.datasetId)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleDeleteDataset(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    if (!datasetStore().remove(tenant, request.params.datasetId)) {
      throw new ApiError("not_found", "Dataset not found", 404);
    }
    return jsonOk({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
