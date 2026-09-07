import type { ArtifactMode, ArtifactRecord, ArtifactSummary } from "@agentforge/core/artifacts";
import { apiFetch, isElectron } from "./api-client";

export type { ArtifactMode, ArtifactRecord, ArtifactSummary };

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

export async function listArtifacts(mode?: ArtifactMode): Promise<ArtifactSummary[]> {
  const query = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  const res = await apiFetch(`/api/v1/artifacts${query}`);
  const data = await readJson<{ items?: ArtifactSummary[] }>(res, "Could not list saved artifacts");
  return Array.isArray(data.items) ? data.items : [];
}

export async function getArtifact(id: string): Promise<ArtifactRecord> {
  const res = await apiFetch(`/api/v1/artifacts/${encodeURIComponent(id)}`);
  return readJson<ArtifactRecord>(res, "Could not open that artifact");
}

export async function deleteArtifact(id: string): Promise<void> {
  const res = await apiFetch(`/api/v1/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" });
  await readJson(res, "Could not delete that artifact");
}

/** Downloads through the host so desktop gets a native save dialog. */
export async function downloadArtifactFile(id: string, fallbackName = "artifact.md"): Promise<void> {
  const res = await apiFetch(`/api/v1/artifacts/${encodeURIComponent(id)}/file`);
  if (!res.ok) {
    throw new Error(errorMessage(await res.json().catch(() => null), "Could not download that artifact"));
  }
  if (isElectron()) {
    // apiFetch already wrote the bytes through the native save dialog.
    return;
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  saveBlob(blob, filename);
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function sendTextToKnowledgeBase(input: {
  name: string;
  text: string;
  type: "Dossier" | "Analysis" | "Brief" | "Paste";
}): Promise<void> {
  const res = await apiFetch("/api/v1/knowledge/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await readJson(res, "Could not add that to the Knowledge Base");
}
