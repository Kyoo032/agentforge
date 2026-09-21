"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useHostCapabilities } from "@/lib/host-capabilities";
import { t } from "@/lib/i18n";

/**
 * Phase 8 — what this account is holding, and the door out of a full one.
 *
 * Phase 6 gave a hosted tenant a ceiling, a counter and `GET /api/v1/storage/usage`. What it did
 * not give them was a screen: the number existed and nothing rendered it, so the first a tenant
 * knew about the quota was a write refused with `storage_quota_exceeded`, with no way to see how
 * much they were holding and nothing to press to free any. That route was deliberately readable
 * while blocked — "a route that refuses the blocked is a dead end in exactly the case it exists
 * for" — and this is the screen that reading was for.
 *
 * **Two things, because one without the other is not useful.** The bar says how much is used; the
 * list underneath is the biggest media objects with a delete on each, because "you are full" that
 * you cannot act on is just bad news. Deleting goes through `DELETE /api/v1/media/:id`, which
 * removes the object through the Phase 6 store and refunds the counter in the same call, so the
 * number this card shows moves as soon as it re-reads.
 *
 * **It renders only where there is a ceiling.** `storageQuota` is false on a desk, where the disk
 * is the owner's own and `limitBytes` is `null` by construction. A desk owner does not need this
 * product to tell them their hard drive is filling up, and a percentage of no limit is not zero,
 * it is nothing.
 */

type StorageUsage = {
  usedBytes: number;
  objectCount: number;
  limitBytes: number | null;
  percent: number | null;
  remainingBytes: number | null;
  warning: string | null;
  blocked: boolean;
};

type MediaItem = {
  id: string;
  kind: string;
  mime: string;
  sizeBytes: number;
};

/** Human bytes. The host has its own copy for logs; this one is for a screen and is localised. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function usageFrom(payload: unknown): StorageUsage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const nested = record.body && typeof record.body === "object" ? (record.body as Record<string, unknown>) : record;
  if (typeof nested.usedBytes !== "number") {
    return null;
  }
  return {
    usedBytes: nested.usedBytes,
    objectCount: typeof nested.objectCount === "number" ? nested.objectCount : 0,
    limitBytes: typeof nested.limitBytes === "number" ? nested.limitBytes : null,
    percent: typeof nested.percent === "number" ? nested.percent : null,
    remainingBytes: typeof nested.remainingBytes === "number" ? nested.remainingBytes : null,
    warning: typeof nested.warning === "string" ? nested.warning : null,
    blocked: nested.blocked === true,
  };
}

/**
 * The `largest` list off the same payload. The host has already ordered it by size and capped it,
 * so this only narrows the types — re-sorting here would be the renderer deciding something the
 * host already decided, and the two would drift the first time the cap changed.
 */
export function largestFrom(payload: unknown): MediaItem[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as Record<string, unknown>;
  const nested = record.body && typeof record.body === "object" ? (record.body as Record<string, unknown>) : record;
  const items = Array.isArray(nested.largest) ? nested.largest : [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : "",
      kind: typeof item.kind === "string" ? item.kind : "file",
      mime: typeof item.mime === "string" ? item.mime : "",
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : 0,
    }))
    .filter((item) => item.id !== "" && item.sizeBytes > 0);
}

const rowButtonClass = "rounded-md px-2 py-1 text-sm text-[var(--danger)] underline disabled:opacity-50";

export function SettingsStorageCard() {
  const capabilities = useHostCapabilities();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // One read: the number and the objects it is made of come from the same payload, so the bar and
  // the list can never disagree about what this account is holding.
  const reload = useCallback(async () => {
    try {
      const res = await apiFetch("/api/v1/storage/usage");
      const payload = await res.json().catch(() => null);
      setUsage(usageFrom(payload));
      setItems(largestFrom(payload));
      setError(null);
    } catch {
      setError(t("settings.storage.failed"));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!capabilities.storageQuota) {
      return;
    }
    void reload();
  }, [capabilities.storageQuota, reload]);

  async function onDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/media/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t("settings.storage.deleteFailed"));
        return;
      }
      // Re-read rather than adjusting locally: the counter is the host's, the bytes an object
      // actually took are the host's, and a number this card computed would drift from both.
      await reload();
    } catch {
      setError(t("settings.storage.deleteFailed"));
    } finally {
      setBusyId(null);
    }
  }

  if (!capabilities.storageQuota) {
    return null;
  }

  const percent = usage?.percent ?? 0;
  const barTone = usage?.blocked ? "var(--danger)" : usage?.warning ? "var(--warn, var(--danger))" : "var(--accent)";

  return (
    <section
      className="mt-6 space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="settings-storage"
    >
      <div>
        <h2 className="font-medium text-[var(--text)]">{t("settings.storage.heading")}</h2>
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("settings.storage.help")}</p>
      </div>

      {!loaded ? (
        <p className="text-sm text-[var(--text-3)]">{t("settings.storage.loading")}</p>
      ) : usage === null ? (
        <p className="text-sm text-[var(--danger)]" data-testid="settings-storage-error">
          {t("settings.storage.failed")}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-[var(--text)]" data-testid="settings-storage-used">
            {usage.limitBytes === null
              ? t("settings.storage.usedNoLimit", { used: formatBytes(usage.usedBytes) })
              : t("settings.storage.used", {
                  used: formatBytes(usage.usedBytes),
                  limit: formatBytes(usage.limitBytes),
                  percent: String(usage.percent ?? 0),
                })}
          </p>
          <div className="h-2 w-full overflow-hidden rounded-pill bg-[var(--line)]">
            <div
              className="h-full rounded-pill"
              style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: barTone }}
            />
          </div>
          {usage.blocked ? (
            <p className="text-sm text-[var(--danger)]" data-testid="settings-storage-full">
              {t("settings.storage.full")}
            </p>
          ) : usage.warning ? (
            <p className="text-sm text-[var(--text-2)]" data-testid="settings-storage-low">
              {t("settings.storage.low")}
            </p>
          ) : null}
        </div>
      )}

      <div className="space-y-1 border-t border-[var(--line)] pt-4">
        <p className="text-sm text-[var(--text)]">{t("settings.storage.biggest")}</p>
        {items.length === 0 ? (
          <p className="text-xs text-[var(--text-3)]">{t("settings.storage.empty")}</p>
        ) : (
          <ul className="space-y-1" data-testid="settings-storage-items">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-[var(--text-2)]">
                  {item.kind} · {formatBytes(item.sizeBytes)}
                </span>
                <button
                  type="button"
                  className={rowButtonClass}
                  data-testid={`settings-storage-delete-${item.id}`}
                  disabled={busyId !== null}
                  onClick={() => void onDelete(item.id)}
                >
                  {t("settings.storage.delete")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p className="text-sm text-[var(--danger)]" data-testid="settings-storage-delete-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
