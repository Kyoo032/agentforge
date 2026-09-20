/**
 * The one Telegram API origin this product talks to.
 *
 * Same rule as the model gateway (`../gateway/pinned.ts`): the host is in code, the owner cannot
 * re-point it from Settings, and the only way to aim it somewhere else is a dev/test env hook that
 * is ignored in a packaged build and in production.
 *
 * Do not import `node:crypto` here — the renderer can reach this module through
 * `@agentforge/core/channels`.
 */

import { gatewayUrlOverrideAllowed } from "../gateway/pinned";

export const PINNED_TELEGRAM_API_ORIGIN = "https://api.telegram.org";

/** Dev/test only: a local mock of the Bot API, used by the sandbox drive. Never honoured in production. */
export const TELEGRAM_API_URL_ENV = "AGENTFORGE_TELEGRAM_API_URL";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * The origin a Telegram call is built on.
 *
 * The override is allowed exactly where the gateway's is — a developer machine or a test — so the
 * shipped product always resolves to `PINNED_TELEGRAM_API_ORIGIN`. A malformed or non-http override
 * is ignored rather than thrown on: a broken env var must not take the whole surface down.
 */
export function resolvedTelegramApiOrigin(env: NodeJS.ProcessEnv = process.env): string {
  if (!gatewayUrlOverrideAllowed()) {
    return PINNED_TELEGRAM_API_ORIGIN;
  }
  const override = env[TELEGRAM_API_URL_ENV];
  if (typeof override !== "string" || !override.trim()) {
    return PINNED_TELEGRAM_API_ORIGIN;
  }
  try {
    const parsed = new URL(override.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return PINNED_TELEGRAM_API_ORIGIN;
    }
    return normalizeOrigin(override);
  } catch {
    return PINNED_TELEGRAM_API_ORIGIN;
  }
}

/** True when the process is talking to the real Telegram, which the UI and the logs both care about. */
export function isPinnedTelegramOrigin(origin: string): boolean {
  return normalizeOrigin(origin) === PINNED_TELEGRAM_API_ORIGIN;
}
