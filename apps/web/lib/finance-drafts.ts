/**
 * One draft per Finance task, per desk.
 *
 * Each task in the rail asks for its own inputs â€” the brief wants pasted
 * figures, cash flow wants months, appraisal wants an outlay â€” so switching
 * between them must not drag one task's half-written draft onto another. The
 * draft therefore lives under `agentforge-finance-draft:<workspaceId>:<task>`
 * rather than one shared key, the way the Market watchlists do.
 *
 * Storage is best effort. `localStorage` throws in private mode and is absent
 * under vitest (this package runs node-only), so every read and write is
 * guarded and falls back to a process-lifetime map. The pure helpers are what
 * the tests drive; the component-facing functions only add the browser store.
 */
import { DEFAULT_FINANCE_TASK, type FinanceTask } from "./finance-task";

/** Key prefix. The desk id and the task id follow, colon separated. */
export const FINANCE_DRAFT_KEY_PREFIX = "agentforge-finance-draft";

/** What a null workspace (the owner's home desk) is called in the key. */
export const HOME_FINANCE_SCOPE = "home";

/** The longest draft field we keep; a pasted spreadsheet is not a draft. */
export const FINANCE_DRAFT_MAX_CHARS = 12_000;

/** What the studio remembers between visits to one task. */
export type FinanceDraft = { readonly prompt: string; readonly figures: string };

/** The slice of `Storage` this module needs; a plain object works in tests. */
export type FinanceDraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const EMPTY_FINANCE_DRAFT: FinanceDraft = Object.freeze({ prompt: "", figures: "" });

/** Used only when the browser has no usable storage (private mode, SSR, vitest). */
const memory = new Map<string, string>();

/** The storage key one desk's copy of one task's draft is written to. */
export function financeDraftKey(workspaceId: string | null | undefined, task: FinanceTask): string {
  const scope = workspaceId?.trim() ? workspaceId.trim() : HOME_FINANCE_SCOPE;
  return `${FINANCE_DRAFT_KEY_PREFIX}:${scope}:${task}`;
}

export function browserFinanceDraftStore(): FinanceDraftStore | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readRaw(store: FinanceDraftStore | undefined, key: string): string | null {
  if (store) {
    try {
      return store.getItem(key);
    } catch {
      // Blocked storage: fall through to the in-memory copy.
    }
  }
  return memory.get(key) ?? null;
}

function writeRaw(store: FinanceDraftStore | undefined, key: string, value: string): void {
  if (store) {
    try {
      store.setItem(key, value);
      return;
    } catch {
      // Quota or private mode: keep the draft for this session at least.
    }
  }
  memory.set(key, value);
}

function removeRaw(store: FinanceDraftStore | undefined, key: string): void {
  if (store) {
    try {
      store.removeItem(key);
    } catch {
      // Nothing to do; the memory copy below is what the session reads.
    }
  }
  memory.delete(key);
}

function readField(source: Record<string, unknown>, field: "prompt" | "figures"): string {
  const value = source[field];
  return typeof value === "string" ? value.slice(0, FINANCE_DRAFT_MAX_CHARS) : "";
}

/**
 * The stored draft, or `null` when the key holds nothing we can use. A value
 * that is not an object of strings counts as nothing: a half-written or
 * hand-edited key must not blank the panel, it must fall back to empty.
 */
export function parseFinanceDraft(raw: string | null | undefined): FinanceDraft | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const source = parsed as Record<string, unknown>;
  return Object.freeze({ prompt: readField(source, "prompt"), figures: readField(source, "figures") });
}

/** The draft to show for one task on this desk; empty when nothing was kept. */
export function loadFinanceDraft(
  workspaceId: string | null | undefined,
  task: FinanceTask = DEFAULT_FINANCE_TASK,
  store: FinanceDraftStore | undefined = browserFinanceDraftStore(),
): FinanceDraft {
  return parseFinanceDraft(readRaw(store, financeDraftKey(workspaceId, task))) ?? EMPTY_FINANCE_DRAFT;
}

/** Remember this task's draft on this desk. An empty draft clears the key. */
export function saveFinanceDraft(
  workspaceId: string | null | undefined,
  task: FinanceTask,
  draft: FinanceDraft,
  store: FinanceDraftStore | undefined = browserFinanceDraftStore(),
): void {
  const clean: FinanceDraft = {
    prompt: draft.prompt.slice(0, FINANCE_DRAFT_MAX_CHARS),
    figures: draft.figures.slice(0, FINANCE_DRAFT_MAX_CHARS),
  };
  const key = financeDraftKey(workspaceId, task);
  if (clean.prompt.trim() === "" && clean.figures.trim() === "") {
    removeRaw(store, key);
    return;
  }
  writeRaw(store, key, JSON.stringify(clean));
}

/** Forget one task's draft, so it opens empty again. */
export function clearFinanceDraft(
  workspaceId: string | null | undefined,
  task: FinanceTask,
  store: FinanceDraftStore | undefined = browserFinanceDraftStore(),
): void {
  removeRaw(store, financeDraftKey(workspaceId, task));
}
