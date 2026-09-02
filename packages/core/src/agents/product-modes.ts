import { ApiError } from "../errors";
import { isDefaultChatAgent } from "./default-chat";

export const PRODUCT_MODES = [
  { id: "chat", label: "Chat", href: "/chat" },
  { id: "agents", label: "Agents", href: "/agents" },
  { id: "documents", label: "Documents", href: "/documents" },
  { id: "research", label: "Research", href: "/research" },
  { id: "images", label: "Images", href: "/images" },
  { id: "videos", label: "Videos", href: "/videos" },
  { id: "presentations", label: "Presentation", href: "/presentations" },
] as const;

export type ProductMode = (typeof PRODUCT_MODES)[number]["id"];

export const PRODUCT_MODE_IDS: ProductMode[] = PRODUCT_MODES.map((mode) => mode.id);

/** Original v1 rail — used for legacy agents that never stored productModes. */
export const LEGACY_PRODUCT_MODES: ProductMode[] = [
  "chat",
  "agents",
  "images",
  "videos",
  "presentations",
];

/** First-run / empty union: talk + a way to Build. */
export const FALLBACK_PRODUCT_MODES: ProductMode[] = ["chat", "agents"];

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
  if (id === "agents") {
    return path === "/agents" || path.startsWith("/agents/") || path.startsWith("/studio");
  }
  const href = productModeHref(id);
  return path === href || path.startsWith(`${href}/`) || path.startsWith(`${href}?`);
}

/**
 * Normalize a stored or submitted list.
 * `null` / `undefined` → `undefined` (legacy).
 * An array (including `[]`) is filtered to catalog ids in catalog order.
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
 * Core surfaces stay reachable even when their rail tab is off.
 * Optional generate / job modes (`/images`, `/videos`, `/documents`,
 * `/research`, `/presentations`) stay fail-closed.
 */
export function redirectIfHiddenMode(path: string, visible: ProductMode[]): string | null {
  if (
    path === "/chat" ||
    path.startsWith("/chat/") ||
    path.startsWith("/chat?") ||
    path === "/agents" ||
    path.startsWith("/agents/") ||
    path.startsWith("/studio") ||
    path.startsWith("/settings") ||
    path.startsWith("/workspaces")
  ) {
    return null;
  }
  const hit = PRODUCT_MODES.find((mode) => productModeMatches(mode.id, path));
  if (!hit || visible.includes(hit.id)) {
    return null;
  }
  return firstVisibleHref(visible);
}

/**
 * Union of custom agents' published surfaces, in catalog order.
 * Default Chat never contributes. Missing productModes = legacy five.
 * Explicit `[]` unlocks nothing. Empty union falls back to Chat + Agents.
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
