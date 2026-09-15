import type { AppLocale } from "@agentforge/core/locale";
import { GATEWAY_BASE_URL } from "@agentforge/core/gateway";

/**
 * Renderer view of the host's gateway key gate.
 *
 * The host decides; this module only parses what it reports and maps it to copy.
 * There is no renderer-side bypass — a gate the host did not report fails closed
 * on the packaged desktop app.
 */

export const GATEWAY_GATE_STATUSES = ["stub", "needs_key", "ok", "invalid_key", "unreachable", "error"] as const;

export type GatewayGateStatus = (typeof GATEWAY_GATE_STATUSES)[number];

export type GatewayGatePayload = {
  status: GatewayGateStatus;
  /** Host's final decision, offline grace included. The renderer never overrides it. */
  allowed: boolean;
  /** Allowed only because the same key validated within the last 7 days. */
  grace: boolean;
  /** The pinned endpoint. Read-only in the UI. */
  endpoint: string;
  endpointLocked: true;
  checkedAt: string | null;
  lastOkAt: string | null;
  /** Redacted technical detail from the host, English. */
  message?: string;
};

export type GateView = "app" | "onboarding";

/** What the renderer assumes when the host reports no gate at all: closed. */
export const MISSING_GATEWAY_GATE: GatewayGatePayload = {
  status: "error",
  allowed: false,
  grace: false,
  endpoint: GATEWAY_BASE_URL,
  endpointLocked: true,
  checkedAt: null,
  lastOkAt: null,
};

export const GATEWAY_BLOCKED_ERROR = "gateway_blocked";

function isGatewayGateStatus(value: unknown): value is GatewayGateStatus {
  return typeof value === "string" && (GATEWAY_GATE_STATUSES as readonly string[]).includes(value);
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Host payload → typed gate, or `null` when the host sent nothing usable. */
export function parseGatewayGate(value: unknown): GatewayGatePayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isGatewayGateStatus(record.status) || typeof record.allowed !== "boolean") {
    return null;
  }
  const message = trimmedOrNull(record.message);
  return {
    status: record.status,
    allowed: record.allowed,
    grace: record.grace === true,
    endpoint: trimmedOrNull(record.endpoint) ?? GATEWAY_BASE_URL,
    endpointLocked: true,
    checkedAt: trimmedOrNull(record.checkedAt),
    lastOkAt: trimmedOrNull(record.lastOkAt),
    ...(message ? { message } : {}),
  };
}

/**
 * The only gate decision in the renderer.
 *
 * A reported gate is obeyed as-is. A missing or malformed gate fails closed on
 * the packaged desktop app; webdev (`pnpm dev`, Playwright) keeps working until
 * the host reports one.
 */
export function resolveGate(payload: unknown, isElectron: boolean): GateView {
  const gate = parseGatewayGate(payload);
  if (!gate) {
    return isElectron ? "onboarding" : "app";
  }
  return gate.allowed ? "app" : "onboarding";
}

/**
 * Window event the renderer uses to push a fresh host gate into the app shell.
 *
 * Settings resets the key through the host, then announces the gate the host
 * returned; `App` re-runs `resolveGate` on it. Nothing here decides anything.
 */
export const GATE_EVENT = "agentforge-gate";

/** Tell the app shell about a gate the host just reported. No-op outside a browser. */
export function announceGate(payload: GatewayGatePayload | null): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent<GatewayGatePayload | null>(GATE_EVENT, { detail: payload }));
}

/** Read a `GATE_EVENT` back, through the same parser as a host payload. */
export function readGateEvent(event: Event): GatewayGatePayload | null {
  return parseGatewayGate((event as CustomEvent<unknown>).detail);
}

const REASON_KEYS: Partial<Record<GatewayGateStatus, string>> = {
  invalid_key: "onboarding.gate.invalidKey",
  unreachable: "onboarding.gate.unreachable",
  error: "onboarding.gate.error",
};

/** Why the user was sent back, or `null` when the status needs no explanation. */
export function gatewayReasonKey(status: GatewayGateStatus | null | undefined): string | null {
  return status ? (REASON_KEYS[status] ?? null) : null;
}

/** Settings status line copy key for a reported status. */
export function gatewayStatusKey(status: GatewayGateStatus): string {
  return `settings.gateway.status.${status}`;
}

export type GatewayBlocked = {
  status: GatewayGateStatus;
  message: string | null;
};

/** 403 body from a gateway-calling route → typed block, or `null` for any other error. */
export function parseGatewayBlocked(body: unknown): GatewayBlocked | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.error !== GATEWAY_BLOCKED_ERROR) {
    return null;
  }
  return {
    status: isGatewayGateStatus(record.status) ? record.status : "error",
    message: trimmedOrNull(record.message),
  };
}

const LOCALE_TAGS: Record<AppLocale, string> = { en: "en-US", id: "id-ID" };

/** ISO timestamp → a date a person can read, or `null` when there is nothing to show. */
export function formatGateTimestamp(
  iso: string | null | undefined,
  locale: AppLocale,
  withTime = false,
): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const options: Intl.DateTimeFormatOptions = withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale] ?? LOCALE_TAGS.en, options).format(date);
}
