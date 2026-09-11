"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import {
  BACKEND_LABEL,
  type KnowledgeBackendId,
  type KnowledgeBackendState,
  backendStatusLine,
  canSelectWeKnora,
} from "@/lib/knowledge-backend";

type Props = {
  /** The `backend` block of `GET /api/v1/knowledge`. Null on hosts older than this build. */
  backend: KnowledgeBackendState | null;
  /** The page's existing reload path; called after every action, success or not. */
  onReload: () => Promise<void> | void;
};

const MUTED = "text-[color-mix(in_srgb,var(--color-text)_52%,transparent)]";

/** How long the host may take to bootstrap the sidecar on the first switch. */
const SWITCH_SECONDS = 30;

const OPTION_HINT: Record<KnowledgeBackendId, string> = {
  builtin: "SQLite hybrid search. Always available.",
  weknora: "Bundled sidecar. Vectors and hybrid scoring, offline.",
};

function healthAttr(backend: KnowledgeBackendState): "ok" | "down" | "unknown" {
  if (!backend.health) {
    return "unknown";
  }
  return backend.health.ok ? "ok" : "down";
}

/**
 * Which engine answers retrieval. Built-in is the default and never goes away; WeKnora is a
 * choice the host only offers when the sidecar is installed. A degraded WeKnora keeps the
 * owner's choice but lets built-in answer, and this card is where that is visible.
 */
export function KnowledgeBackendCard({ backend, onReload }: Props) {
  const [choice, setChoice] = useState<KnowledgeBackendId>(backend?.selected ?? "builtin");
  const [busy, setBusy] = useState<KnowledgeBackendId | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<number | null>(null);
  const selected = backend?.selected ?? "builtin";

  useEffect(() => {
    setChoice(selected);
  }, [selected]);

  if (!backend) {
    return (
      <p className={`text-[12px] ${MUTED}`} data-testid="knowledge-backend-unsupported">
        This host does not offer a knowledge backend choice. Built-in search is answering.
      </p>
    );
  }

  const weknoraBlocked = !canSelectWeKnora(backend) && selected !== "weknora";
  const reason = backend.reason ?? "WeKnora is not available on this host";

  async function reload() {
    try {
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reload knowledge");
    }
  }

  async function apply() {
    if (busy || choice === selected) {
      return;
    }
    setBusy(choice);
    setError(null);
    setQueued(null);
    try {
      const res = await apiFetch("/api/v1/knowledge/backend", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: choice }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not switch the knowledge backend");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch the knowledge backend");
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function reindex() {
    if (reindexing) {
      return;
    }
    setReindexing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/knowledge/backend/reindex", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not re-index sources");
        return;
      }
      const count =
        typeof data?.queued === "number" && Number.isFinite(data.queued) ? Math.max(0, Math.trunc(data.queued)) : 0;
      setQueued(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-index sources");
    } finally {
      setReindexing(false);
      await reload();
    }
  }

  return (
    <section className="blueprint mb-4 p-[18px]" data-testid="knowledge-backend" aria-label="Knowledge backend">
      <p className="panel-label">Search engine</p>
      <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3">
        {(["builtin", "weknora"] as const).map((id) => {
          const disabled = id === "weknora" && weknoraBlocked;
          return (
            <label
              key={id}
              className={`flex max-w-[280px] cursor-pointer items-start gap-2 ${disabled ? "opacity-60" : ""}`}
              title={disabled ? reason : undefined}
            >
              <input
                type="radio"
                name="knowledge-backend-choice"
                className="mt-[3px]"
                checked={choice === id}
                disabled={disabled || busy !== null}
                onChange={() => setChoice(id)}
                data-testid={`knowledge-backend-${id}`}
              />
              <span>
                <span className="text-[13px]">{BACKEND_LABEL[id]}</span>
                <span className={`block text-[12px] ${MUTED}`}>{disabled ? reason : OPTION_HINT[id]}</span>
              </span>
            </label>
          );
        })}
      </div>

      <p
        className={`mt-3 text-[12px] ${MUTED}`}
        data-testid="knowledge-backend-status"
        data-id={backend.id}
        data-selected={backend.selected}
        data-health={healthAttr(backend)}
        data-outbox={backend.outbox}
        title={backend.health?.detail || undefined}
      >
        {backendStatusLine(backend)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || choice === selected}
          onClick={() => void apply()}
          data-testid="knowledge-backend-apply"
        >
          Switch
        </button>
        {selected === "weknora" ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={reindexing || busy !== null}
            onClick={() => void reindex()}
            data-testid="knowledge-backend-reindex"
          >
            {reindexing ? "Queueing…" : "Re-index existing sources"}
          </button>
        ) : null}
      </div>

      {busy ? (
        <p className={`mt-2 text-[12px] ${MUTED}`} data-testid="knowledge-backend-busy">
          {busy === "weknora"
            ? `Starting WeKnora… the first switch can take up to ${SWITCH_SECONDS} seconds.`
            : "Switching back to built-in search…"}
        </p>
      ) : null}
      {queued !== null ? (
        <p className={`mt-2 text-[12px] ${MUTED}`} data-testid="knowledge-backend-queued" data-queued={queued}>
          {queued} queued for re-index. The queue count above drops as they land.
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-[12px] text-red-700" data-testid="knowledge-backend-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
