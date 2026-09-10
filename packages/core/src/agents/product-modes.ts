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
  { id: "images", label: "Images", href: "/images" },
  { id: "videos", label: "Videos", href: "/videos" },
  { id: "edit", label: "Edit", href: "/edit" },
  { id: "presentations", label: "Presentation", href: "/presentations" },
] as const;

export type ProductMode = (typeof PRODUCT_MODES)[number]["id"];

export const PRODUCT_MODE_IDS: ProductMode[] = PRODUCT_MODES.map((mode) => mode.id);

/** Default / General desk — every work mode, no Agents tab. */
export const WORK_PRODUCT_MODES: ProductMode[] = [...PRODUCT_MODE_IDS];

/** Original v1 rail minus Agents — used for legacy agents that never stored productModes. */
export const LEGACY_PRODUCT_MODES: ProductMode[] = [
  "chat",
  "images",
  "videos",
  "presentations",
];

/** First-run / empty / missing workspace list: all work modes. */
export const FALLBACK_PRODUCT_MODES: ProductMode[] = [...WORK_PRODUCT_MODES];

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
