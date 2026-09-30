import { ApiError } from "../errors";
import { isDefaultChatAgent } from "./default-chat";

export const PRODUCT_MODES = [
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "documents", label: "Documents", href: "/documents" },
  { id: "research", label: "Research", href: "/research" },
  { id: "finance", label: "Finance", href: "/finance" },
  { id: "data", label: "Data", href: "/data" },
  { id: "market", label: "Market", href: "/market" },
  { id: "legal", label: "Legal", href: "/legal" },
  { id: "meeting", label: "Meeting", href: "/meeting" },
  { id: "images", label: "Images", href: "/images" },
  { id: "videos", label: "Videos", href: "/videos" },
  { id: "music", label: "Music", href: "/music" },
  { id: "edit", label: "Edit", href: "/edit" },
  { id: "presentations", label: "Presentation", href: "/presentations" },
  { id: "education", label: "Education", href: "/education" },
] as const;

export type ProductMode = (typeof PRODUCT_MODES)[number]["id"];

export const PRODUCT_MODE_IDS: ProductMode[] = PRODUCT_MODES.map((mode) => mode.id);

/**
 * Every work mode, no Agents tab: the General preset for a *new* desk, the hosted first desk
 * (`HOSTED_FIRST_DESK_MODES`) and what a stored row with nothing in it reads as. It is not what a
 * fresh Personal install's first desk starts with; that is `FIRST_RUN_MODES`.
 */
export const WORK_PRODUCT_MODES: ProductMode[] = [...PRODUCT_MODE_IDS];

/** Original v1 rail minus Agents — used for legacy agents that never stored productModes. */
export const LEGACY_PRODUCT_MODES: ProductMode[] = ["chat", "images", "videos", "presentations"];

/**
 * A desk row that stores no modes (a pre-column row, a hand-edited `[]`) reads as every mode, so an
 * existing desk can never lose its rail by being read. This is a READ fallback, not the first-run
 * default: see `FIRST_RUN_MODES` for what a fresh install's first desk is created with.
 */
export const FALLBACK_PRODUCT_MODES: ProductMode[] = [...WORK_PRODUCT_MODES];

/**
 * The modes the FIRST desk of a fresh Personal install is created with (owner decision, Rizky,
 * 2026-09-29): Research, Images, Videos and Presentation, and nothing else. Chat is not one of the
 * "Create" modes; it is the home every desk has (`resolveWorkspaceModes` forces it in), so it is
 * listed here to keep the stored row equal to what the rail shows.
 *
 * A HARD rule, not a default. Every path that creates a first desk on a fresh Personal data dir goes
 * through `firstDeskModes` (`packages/db/src/ensure-local-owner.ts` is the only one), and
 * `packages/host/src/first-run-modes.test.ts` fails if a fresh data dir's first desk has any other
 * mode set. It is written out literally, not derived from the catalog, so a new catalog entry can
 * never join a first-run desk by accident. The owner adds the rest later from Workspaces, which edits
 * this desk's `productModes`; nothing about an existing desk changes.
 */
export const FIRST_RUN_MODES: readonly ProductMode[] = Object.freeze([
  "chat",
  "research",
  "images",
  "videos",
  "presentations",
] satisfies ProductMode[]);

/**
 * What the hosted Enterprise app creates a tenant's first desk with: every mode, exactly as before.
 * The owner has not decided Enterprise's first desk, so the Personal rule above does not reach it.
 * `ensurePortalOwner` (`packages/db/src/portal-owner.ts`) reads this; `ensureLocalOwner` reads
 * `FIRST_RUN_MODES` through `firstDeskModes(false)`.
 */
export const HOSTED_FIRST_DESK_MODES: readonly ProductMode[] = Object.freeze([...WORK_PRODUCT_MODES]);

/**
 * The single answer to "what does a first desk start with?". `hosted` is `isServerMode()` from the
 * caller, passed in rather than read here so this module stays free of `process` (the renderer
 * imports it). Returns a fresh array; the constants are frozen.
 */
export function firstDeskModes(hosted: boolean): ProductMode[] {
  return [...(hosted ? HOSTED_FIRST_DESK_MODES : FIRST_RUN_MODES)];
}

export type ProductModeSource = {
  slug: string;
  productModes?: ProductMode[] | string[] | null;
};

const MODE_ID_SET = new Set<string>(PRODUCT_MODE_IDS);

export function isProductMode(value: string): value is ProductMode {
  return MODE_ID_SET.has(value);
}

export function productModeHref(id: ProductMode): string {
  return PRODUCT_MODES.find((mode) => mode.id === id)?.href ?? "/chat";
}

export function productModeLabel(id: ProductMode): string {
  return PRODUCT_MODES.find((mode) => mode.id === id)?.label ?? id;
}

export function productModeMatches(id: ProductMode, path: string): boolean {
  if (id === "chat") {
    return path === "/chat" || path.startsWith("/chat?");
  }
  const href = productModeHref(id);
  return path === href || path.startsWith(`${href}/`) || path.startsWith(`${href}?`);
}

export function isParkedAgentPath(path: string): boolean {
  return path === "/agents" || path.startsWith("/agents/") || path.startsWith("/studio");
}

/**
 * Normalize a stored or submitted list.
 * `null` / `undefined` → `undefined` (legacy).
 * An array (including `[]`) is filtered to catalog ids in catalog order.
 * Unknown ids including parked `agents` are dropped.
 */
export function sanitizeProductModes(input: unknown): ProductMode[] | undefined {
  if (input == null) {
    return undefined;
  }
  if (!Array.isArray(input)) {
    return undefined;
  }
  const seen = new Set<ProductMode>();
  for (const item of input) {
    if (typeof item === "string" && isProductMode(item) && !seen.has(item)) {
      seen.add(item);
    }
  }
  return PRODUCT_MODE_IDS.filter((id) => seen.has(id));
}

export function requireProductModes(input: unknown, fallback: ProductMode[] = ["chat"]): ProductMode[] {
  if (input == null) {
    return [...fallback];
  }
  const modes = sanitizeProductModes(input);
  if (!modes || modes.length === 0) {
    throw new ApiError("invalid_request", "Select at least one product surface", 400);
  }
  return modes;
}

export function firstVisibleHref(visible: ProductMode[]): string {
  if (visible.includes("chat")) {
    return productModeHref("chat");
  }
  const first = PRODUCT_MODE_IDS.find((id) => visible.includes(id));
  return first ? productModeHref(first) : productModeHref("chat");
}

/**
 * Workspace-owned rail. Missing / empty / invalid → all work modes.
 * Always includes Chat. Catalog order. Drops unknown ids.
 */
export function resolveWorkspaceModes(stored: unknown): ProductMode[] {
  const sanitized = sanitizeProductModes(stored);
  if (!sanitized || sanitized.length === 0) {
    return [...FALLBACK_PRODUCT_MODES];
  }
  if (sanitized.includes("chat")) {
    return sanitized;
  }
  return PRODUCT_MODE_IDS.filter((id) => id === "chat" || sanitized.includes(id));
}

/**
 * Core Chat plus Settings / Workspaces stay reachable.
 * Parked Agents / Studio URLs redirect to the first visible mode.
 * Optional generate / job modes stay fail-closed.
 */
export function redirectIfHiddenMode(path: string, visible: ProductMode[]): string | null {
  if (
    path === "/chat" ||
    path.startsWith("/chat/") ||
    path.startsWith("/chat?") ||
    path.startsWith("/settings") ||
    path.startsWith("/workspaces") ||
    path.startsWith("/usage") ||
    path.startsWith("/knowledge")
  ) {
    return null;
  }
  if (isParkedAgentPath(path)) {
    return firstVisibleHref(visible);
  }
  const hit = PRODUCT_MODES.find((mode) => productModeMatches(mode.id, path));
  if (!hit || visible.includes(hit.id)) {
    return null;
  }
  return firstVisibleHref(visible);
}

/**
 * Union of custom agents' published surfaces, in catalog order.
 * Default Chat never contributes. Missing productModes = legacy four.
 * Explicit `[]` unlocks nothing. Empty union falls back to all work modes.
 * Rail no longer uses this — workspaces own visible modes.
 */
export function resolveProductModes(sources: ProductModeSource[]): ProductMode[] {
  const custom = sources.filter((source) => !isDefaultChatAgent(source));
  if (custom.length === 0) {
    return [...FALLBACK_PRODUCT_MODES];
  }
  const union = new Set<ProductMode>();
  for (const source of custom) {
    const sanitized = sanitizeProductModes(source.productModes);
    const effective = sanitized === undefined ? LEGACY_PRODUCT_MODES : sanitized;
    for (const mode of effective) {
      union.add(mode);
    }
  }
  if (union.size === 0) {
    return [...FALLBACK_PRODUCT_MODES];
  }
  return PRODUCT_MODE_IDS.filter((id) => union.has(id));
}
