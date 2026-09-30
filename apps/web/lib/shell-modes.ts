import {
  FIRST_RUN_MODES,
  resolveWorkspaceModes,
  sanitizeProductModes,
  type ProductMode,
} from "@agentforge/core/product-modes";

/**
 * What the shell knows about the current desk's modes, and where it learned it.
 *
 * The rail is the desk's `productModes` and only `GET /api/v1/workspaces` says what that is. The
 * shell mounts a moment before that answer arrives, and it used to start from every mode, so the
 * first frames of a fresh Personal install drew fourteen tabs for a desk that has five, and narrowed
 * them when the answer landed. The stored desk was right; the first paint was not. This is the rule
 * that replaced the guess: the rail never draws a mode it has not been told the desk has.
 *
 *   unknown  Nothing cached and the host has not answered (a brand-new install, or storage that was
 *            cleared). Chat is the one mode every desk has (`resolveWorkspaceModes` forces it in),
 *            so it is drawn; the other modes are a quiet skeleton until the answer arrives.
 *   cache    The modes of the desk this browser last drew, kept only so a returning person's first
 *            frame is the frame they left. A hint, never truth: nothing may act on it (the redirect
 *            for a hidden mode waits for `host`), and the host's answer replaces it.
 *   host     The host's answer. The only source the shell acts on.
 *
 * Pure on purpose: `Shell` (`src/App.tsx`) owns the state and the browser storage, this file owns the
 * rules, and `lib/shell-modes.test.ts` pins them.
 */
export type ShellModesSource = "unknown" | "cache" | "host";

export type ShellModes = {
  readonly source: ShellModesSource;
  readonly modes: ProductMode[];
};

/** localStorage key prefix. A hosted browser appends the tenant, so one account never reads another's. */
export const SHELL_MODES_KEY = "agentforge-shell-modes";

/** The only mode a desk cannot lack, and so the only one that may be drawn before anything is known. */
export const UNKNOWN_DESK_MODES: readonly ProductMode[] = Object.freeze(["chat"] satisfies ProductMode[]);

/**
 * Skeleton rows drawn for the job modes while the desk is unknown: the job modes of a fresh Personal
 * desk (Research, Images, Videos, Presentation), because a person with nothing cached is almost
 * always a person on a fresh Personal desk, and the account links below then do not move.
 */
export const SKELETON_MODE_ROWS: number = FIRST_RUN_MODES.filter((id) => id !== "chat").length;

/** The storage key for a browser: per tenant on the hosted app, one key on a Personal desk. */
export function shellModesCacheKey(tenantId: string | null | undefined): string {
  const tenant = typeof tenantId === "string" ? tenantId.trim() : "";
  return tenant ? `${SHELL_MODES_KEY}:${tenant}` : SHELL_MODES_KEY;
}

/**
 * A stored cache value → the modes it names, or null when it names none a desk could have.
 *
 * Stricter than `resolveWorkspaceModes` on purpose: that function reads an empty list as "every
 * mode" so an old desk never loses its rail, which is exactly the guess this file removes. A cache
 * with no Chat in it was never written by a host answer (which always carries Chat), so it is
 * discarded, not repaired.
 */
export function parseCachedShellModes(raw: string | null | undefined): ProductMode[] | null {
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const modes = sanitizeProductModes(value);
  if (!modes?.includes("chat")) {
    return null;
  }
  return modes;
}

/** The state the shell starts in: last-known modes when there are any, otherwise unknown. */
export function initialShellModes(cachedRaw: string | null | undefined): ShellModes {
  const cached = parseCachedShellModes(cachedRaw);
  return cached ? { source: "cache", modes: cached } : { source: "unknown", modes: [...UNKNOWN_DESK_MODES] };
}

/** The state after the host has named the desk. `productModes` is the row as the host sent it. */
export function shellModesFromHost(productModes: unknown): ShellModes {
  return { source: "host", modes: resolveWorkspaceModes(productModes) };
}

/** What gets stored: the host's list, catalog order, nothing else. */
export function serializeShellModes(modes: readonly ProductMode[]): string {
  return JSON.stringify(modes);
}

/** The rail draws a skeleton for the job modes exactly while nothing is known. */
export function railModesPending(source: ShellModesSource): boolean {
  return source === "unknown";
}

/** Only the host's answer may send someone away from a mode the desk does not have. */
export function modeRedirectAllowed(source: ShellModesSource): boolean {
  return source === "host";
}

/** The slice of `Storage` this file reads and writes; a plain object stands in for it in tests. */
export type ShellModesStore = Pick<Storage, "getItem" | "setItem">;

/** The browser's storage, or undefined when there is none (vitest, SSR) or it throws (private mode). */
export function browserShellModesStore(): ShellModesStore | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The cached value under `key`. A blocked or absent store reads as nothing cached. */
export function readShellModesCache(key: string, store: ShellModesStore | undefined): string | null {
  if (!store) {
    return null;
  }
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Remember the desk the host just named, for the next first paint. Skipped when the stored value is
 * already this one (the shell asks on every navigation), and best effort: a full or blocked store
 * costs the next first frame its cache and nothing else.
 */
export function writeShellModesCache(key: string, modes: readonly ProductMode[], store: ShellModesStore | undefined): void {
  if (!store) {
    return;
  }
  const next = serializeShellModes(modes);
  try {
    if (store.getItem(key) === next) {
      return;
    }
    store.setItem(key, next);
  } catch {
    // Blocked or full: the cache is a nicety.
  }
}
