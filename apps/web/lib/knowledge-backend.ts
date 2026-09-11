/**
 * Pure helpers for the knowledge backend selector: validate the `backend` block of
 * `GET /api/v1/knowledge` at the boundary, and turn it into one human sentence.
 *
 * `id` is the engine answering right now; `selected` is the owner's choice. They differ when
 * WeKnora is selected but degraded — built-in keeps answering, so the page must say so.
 * Every field is optional on purpose: a host older than this build reports no `backend` at all.
 */

export const KNOWLEDGE_BACKEND_IDS = ["builtin", "weknora"] as const;

export type KnowledgeBackendId = (typeof KNOWLEDGE_BACKEND_IDS)[number];

export type KnowledgeBackendHealth = { ok: boolean; detail: string };

export type KnowledgeBackendState = {
  /** The engine answering retrieval right now. */
  id: KnowledgeBackendId;
  /** The engine the owner picked. */
  selected: KnowledgeBackendId;
  /** Whether WeKnora is installed and healthy enough to be chosen. */
  available: boolean;
  /** Why WeKnora cannot be chosen, when it cannot. */
  reason: string | null;
  /** Last sidecar health probe; null before the first probe. */
  health: KnowledgeBackendHealth | null;
  /** Writes queued for the sidecar while it was down. Drains on the next health-OK. */
  outbox: number;
};

const ID_SET = new Set<string>(KNOWLEDGE_BACKEND_IDS);

export function isKnowledgeBackendId(value: unknown): value is KnowledgeBackendId {
  return typeof value === "string" && ID_SET.has(value);
}

export const BACKEND_LABEL: Record<KnowledgeBackendId, string> = {
  builtin: "Built-in search",
  weknora: "WeKnora",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function asHealth(value: unknown): KnowledgeBackendHealth | null {
  const row = asRecord(value);
  if (!row || typeof row.ok !== "boolean") {
    return null;
  }
  return { ok: row.ok, detail: asText(row.detail) };
}

/**
 * Untrusted payload in, typed backend state out. Returns null when the host reports no usable
 * `backend` block — the caller then hides the selector instead of guessing.
 */
export function normalizeBackend(value: unknown): KnowledgeBackendState | null {
  const row = asRecord(value);
  if (!row || !isKnowledgeBackendId(row.id)) {
    return null;
  }
  return {
    id: row.id,
    selected: isKnowledgeBackendId(row.selected) ? row.selected : row.id,
    available: row.available === true,
    reason: asText(row.reason) || null,
    health: asHealth(row.health),
    outbox: asCount(row.outbox),
  };
}

function healthWord(health: KnowledgeBackendHealth | null): string {
  if (!health) {
    return "not checked yet";
  }
  return health.ok ? "healthy" : "unhealthy";
}

/** One sentence the owner can read without knowing what a backend is. */
export function backendStatusLine(backend: KnowledgeBackendState | null | undefined): string {
  if (!backend) {
    return BACKEND_LABEL.builtin;
  }
  if (backend.selected === "weknora") {
    const queued = `${backend.outbox} queued`;
    if (backend.id === "weknora") {
      return `${BACKEND_LABEL.weknora} · ${healthWord(backend.health)} · ${queued}`;
    }
    return `${BACKEND_LABEL.weknora} selected · degraded, built-in answering · ${queued}`;
  }
  if (!backend.available && backend.reason) {
    return `${BACKEND_LABEL.weknora} not installed: ${backend.reason}`;
  }
  return BACKEND_LABEL.builtin;
}

/** Whether the WeKnora option can be picked. The host is the only authority on this. */
export function canSelectWeKnora(backend: KnowledgeBackendState | null | undefined): boolean {
  return backend?.available === true;
}
