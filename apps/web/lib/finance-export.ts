/**
 * Finance leaves as a file. Excel is the default, PowerPoint and Word sit beside it, and the choice
 * is remembered per desk so the second export is one click.
 *
 * Storage is best effort: `localStorage` throws in private mode and is absent under vitest (this
 * package runs node-only), so every read and write is guarded and falls back to a process-lifetime
 * map, the same way the Finance drafts do.
 */
import type { FinanceBrief } from "@agentforge/core/artifacts";
import type { FinanceReport } from "@agentforge/core/finance";
import { apiFetch, isElectron } from "./api-client";
import { saveBlob } from "./artifacts-client";

/** The formats the picker offers. The registry can render more; these are the ones Finance shows. */
export const FINANCE_EXPORT_FORMATS = ["xlsx", "pptx", "docx"] as const;

export type FinanceExportFormat = (typeof FINANCE_EXPORT_FORMATS)[number];

export const DEFAULT_FINANCE_EXPORT_FORMAT: FinanceExportFormat = "xlsx";

/** Key prefix. The desk id follows, colon separated. */
export const FINANCE_EXPORT_KEY_PREFIX = "agentforge-finance-export-format";

/** What a null workspace (the owner's home desk) is called in the key. */
export const HOME_EXPORT_SCOPE = "home";

export const FINANCE_EXPORT_ENDPOINT = "/api/v1/finance/export";

/** Used when the host sends no Content-Disposition (it always does; this is the seatbelt). */
export const FINANCE_EXPORT_FALLBACK_NAME: Record<FinanceExportFormat, string> = {
  xlsx: "finance-report.xlsx",
  pptx: "finance-report.pptx",
  docx: "finance-report.docx",
};

/** The slice of `Storage` this module needs; a plain object works in tests. */
export type FinanceExportStore = Pick<Storage, "getItem" | "setItem">;

const memory = new Map<string, string>();

export function isFinanceExportFormat(value: unknown): value is FinanceExportFormat {
  return typeof value === "string" && (FINANCE_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function financeExportKey(workspaceId: string | null | undefined): string {
  const scope = workspaceId?.trim() ? workspaceId.trim() : HOME_EXPORT_SCOPE;
  return `${FINANCE_EXPORT_KEY_PREFIX}:${scope}`;
}

export function browserFinanceExportStore(): FinanceExportStore | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readRaw(store: FinanceExportStore | undefined, key: string): string | null {
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      // Blocked storage: fall through to the in-memory copy.
    }
  }
  return memory.get(key) ?? null;
}

function writeRaw(store: FinanceExportStore | undefined, key: string, value: string): void {
  if (store) {
    try {
      store.setItem(key, value);
      return;
    } catch {
      // Quota or private mode: keep the choice for this session at least.
    }
  }
  memory.set(key, value);
}

/** The format this desk last exported as; the workbook until the reader picks something else. */
export function loadFinanceExportFormat(
  workspaceId: string | null | undefined,
  store: FinanceExportStore | undefined = browserFinanceExportStore(),
): FinanceExportFormat {
  const raw = readRaw(store, financeExportKey(workspaceId));
  return isFinanceExportFormat(raw) ? raw : DEFAULT_FINANCE_EXPORT_FORMAT;
}

export function saveFinanceExportFormat(
  workspaceId: string | null | undefined,
  format: FinanceExportFormat,
  store: FinanceExportStore | undefined = browserFinanceExportStore(),
): void {
  if (!isFinanceExportFormat(format)) {
    return;
  }
  writeRaw(store, financeExportKey(workspaceId), format);
}

/**
 * What the host renders. The brief sends its brief; a task sends the report it is showing, because
 * there is no `FinanceBrief` behind a cash-flow or a ratio run. Either way the file is a re-render
 * of numbers that were computed in code, never a recomputation.
 */
export type FinanceExportRequest = {
  readonly brief?: FinanceBrief;
  readonly report?: FinanceReport;
  readonly artifactId?: string | null;
  readonly format: FinanceExportFormat;
  readonly task?: string;
};

export function financeExportBody(request: FinanceExportRequest): Record<string, unknown> {
  return {
    ...(request.report ? { report: request.report } : {}),
    ...(request.brief ? { brief: request.brief } : {}),
    format: request.format,
    ...(request.artifactId ? { artifactId: request.artifactId } : {}),
    ...(request.task ? { task: request.task } : {}),
  };
}

export function filenameFromDisposition(disposition: string | null, format: FinanceExportFormat): string {
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? FINANCE_EXPORT_FALLBACK_NAME[format];
}

function messageFrom(payload: unknown, fallback: string): string {
  const error = (payload as { error?: { message?: unknown } } | null)?.error;
  return typeof error?.message === "string" && error.message.trim() ? error.message : fallback;
}

/** One request, one file. On desktop the host writes it natively, so there is nothing to save here. */
export async function downloadFinanceExport(request: FinanceExportRequest, failureMessage: string): Promise<void> {
  const res = await apiFetch(FINANCE_EXPORT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(financeExportBody(request)),
  });
  if (!res.ok) {
    throw new Error(messageFrom(await res.json().catch(() => null), failureMessage));
  }
  if (isElectron()) {
    return;
  }
  saveBlob(await res.blob(), filenameFromDisposition(res.headers.get("Content-Disposition"), request.format));
}
