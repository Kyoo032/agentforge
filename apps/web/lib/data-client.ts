import type { DataAnalysis } from "@agentforge/core/artifacts";
import type { ColumnType, TableProfile } from "@agentforge/core/tabular";
import { apiFetch } from "./api-client";

export type DatasetColumn = { name: string; identifier: string; type: ColumnType };

export type DatasetSummary = {
  id: string;
  workspaceId: string;
  name: string;
  filename: string;
  rows: number;
  cols: number;
  columns: DatasetColumn[];
  sizeBytes: number;
  createdAt: number;
};

export type DatasetPayload = DatasetSummary & {
  profile: TableProfile;
  preview: { columns: string[]; rows: string[][]; total: number };
};

export type DataAnalysisResult = {
  analysis: DataAnalysis;
  artifactId: string | null;
  dataset: DatasetSummary;
  markdown: string;
};

/** Mirrors DATASET_MAX_BYTES on the host. */
export const DATASET_MAX_BYTES = 25 * 1024 * 1024;
export const DATASET_ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,text/csv,text/tab-separated-values,text/plain";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(errorMessage(data, fallback));
  }
  return data as T;
}

export async function uploadDatasetFile(file: File): Promise<DatasetPayload> {
  if (file.size > DATASET_MAX_BYTES) {
    throw new Error("That file is over the 25 MB cap");
  }
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await apiFetch("/api/v1/datasets", { method: "POST", body: form });
  return readJson<DatasetPayload>(res, "Could not read that file as a table");
}

export async function createPastedDataset(name: string, text: string): Promise<DatasetPayload> {
  const res = await apiFetch("/api/v1/datasets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  return readJson<DatasetPayload>(res, "Could not read the pasted text as a table");
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  const res = await apiFetch("/api/v1/datasets");
  const data = await readJson<{ items?: DatasetSummary[] }>(res, "Could not list datasets");
  return Array.isArray(data.items) ? data.items : [];
}

export async function getDataset(id: string): Promise<DatasetPayload> {
  const res = await apiFetch(`/api/v1/datasets/${encodeURIComponent(id)}`);
  return readJson<DatasetPayload>(res, "Could not open that dataset");
}

export async function deleteDataset(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/datasets/${encodeURIComponent(id)}`, { method: "DELETE" });
  await readJson(res, "Could not delete that dataset");
}

/** Re-exported for `components/data-studio.tsx`; the one implementation lives in core. */
export { formatBytes } from "@agentforge/core/format-bytes";
