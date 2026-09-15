/**
 * Shared host/renderer contract for "Start over".
 *
 * The confirmation word is deliberately not localized: it is a safety latch, not copy. The host
 * (`handlers/settings.ts`) and the renderer (`apps/web/lib/reset-app.ts`) must agree on it exactly,
 * so it lives here rather than being spelled twice.
 */
export const RESET_CONFIRM_WORD = "RESET";

export type ResetScope = "key" | "all";
