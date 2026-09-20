/**
 * The host half of the gateway key gate.
 *
 * The host decides, the renderer displays: `allowed` is the only thing the renderer branches on,
 * and it never re-derives a decision from `hasOpenai` or key shape. The contract is
 * `GatewayGatePayload` in `@agentforge/core` (`gateway/gate-types.ts`).
 *
 * Split in two on purpose: `deriveGatewayGate` is pure (every rule is unit-testable with no disk
 * and no network), and the rest is the IO around it — a small state file next to the settings, and
 * one live call to the gateway on a 3 s budget.
 */
import {
  ApiError,
  assertAllowedEndpointUrl,
  type EnvLike,
  type GatewayGatePayload,
  type GatewayGateStatus,
  isServerMode,
  keyFingerprintOrNull,
  redactSecrets,
  resolveProviderKeys,
  resolvedGatewayBaseUrl,
  type StoredSecrets,
  type TenantContext,
} from "@agentforge/core";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tenantDataDir } from "./tenant-paths";
import { loadSettings, resolveSettingsScope, type SettingsScope } from "./settings-store";

export const GATEWAY_GATE_FILE = "gateway-gate.json";

/**
 * Offline grace: the same key, validated within this window, keeps the app open. Kyo has not
 * settled the length; 7 days is the draft in AGENTS.md.
 */
export const GATEWAY_GRACE_MS = 7 * 86_400_000;

/** Same budget as the account calls in `@agentforge/core`: first paint never waits longer. */
export const GATEWAY_CHECK_TIMEOUT_MS = 3_000;

/**
 * How long an `ok` verdict stands on its own. Past this the desk keeps working on grace while a
 * background re-check runs, so a key revoked upstream stops working within a day rather than a week.
 */
export const GATEWAY_OK_TTL_MS = 86_400_000;

/** At most one background re-check per key per this window, per process. */
export const GATEWAY_REFRESH_THROTTLE_MS = 600_000;

/** What the gate says before any check has run for this key. Never a reason to lock a desk out. */
export const GATEWAY_UNCHECKED_MESSAGE = "Not checked yet.";

/**
 * Server mode has no "first run to trust": a tenant key nobody has validated buys nothing until the
 * gateway answers for it. Reported as `error` — the one status whose copy already says the key could
 * not be validated, in both catalogs — so no new status has to be taught to the renderer.
 */
export const GATEWAY_UNVERIFIED_MESSAGE = "This gateway key has not been verified with the gateway yet.";

/**
 * What the gate says when the key itself saved but its verdict could not be refreshed or written —
 * an unwritable data dir, a full disk. English and redacted, like every other gate message: the
 * renderer only ever displays `message`, it never parses it.
 */
export const GATEWAY_VERDICT_UNWRITABLE_MESSAGE = "Your key was saved, but its gateway check could not be stored.";

export type GateState = {
  version: 1;
  /** Which key this verdict belongs to. A different key means the verdict is worthless. */
  fingerprint: string | null;
  status: GatewayGateStatus;
  checkedAt: string | null;
  lastOkAt: string | null;
  message?: string;
};

export type GatewayCheckResult = {
  status: GatewayGateStatus;
  checkedAt: string;
  message?: string;
};

export type DeriveGatewayGateInput = {
  envRuntime: string | undefined;
  hasKey: boolean;
  fingerprint: string | null;
  endpoint: string;
  state: GateState | null;
  now: Date;
  graceMs?: number;
  okTtlMs?: number;
  /** Injected so the hosted rules are testable without touching `process.env`. */
  env?: EnvLike;
};

export type GatewayGateOptions = {
  /**
   * Phase 3 lane D: whose verdict this is. Same rule as `loadSettings` — a `TenantContext` names
   * the tenant, a bare string or nothing means the local tenant and is refused in server mode.
   * Without it two tenants would overwrite each other's verdict in one file, and in server mode
   * "no verdict for this key" closes the gate, so tenant A's check would lock tenant B out.
   */
  tenant?: SettingsScope;
  now?: Date;
  envRuntime?: string;
  graceMs?: number;
  okTtlMs?: number;
  env?: EnvLike;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type MaybeRefreshGatewayOptions = GatewayGateOptions & {
  /** Injected in tests so the throttle can be driven without waiting ten real minutes. */
  nowMs?: () => number;
  throttleMs?: number;
  /** Injected in tests: the check that is fired and forgotten. */
  runCheck?: (settings: StoredSecrets, opts: GatewayGateOptions) => Promise<unknown>;
};

/** `<dataDir>/gateway-gate.json` for the local tenant; under `tenants/<tenantId>/` for anyone else. */
function statePath(tenantId: string): string {
  return resolve(tenantDataDir(tenantId), GATEWAY_GATE_FILE);
}

function tenantOf(opts: GatewayGateOptions): string {
  return resolveSettingsScope(opts.tenant).tenantId;
}

function isGatewayGateStatus(value: unknown): value is GatewayGateStatus {
  return (
    value === "stub" ||
    value === "needs_key" ||
    value === "ok" ||
    value === "invalid_key" ||
    value === "unreachable" ||
    value === "error"
  );
}

function readIso(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** Whatever a `catch` caught, as text worth putting through `redactSecrets` before logging. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The saved verdict, or null when there is none / it cannot be trusted. Never throws. */
export function loadGateState(tenantId: string): GateState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(statePath(tenantId), "utf8")) as unknown;
  } catch {
    // Absent, unreadable or not JSON: treat as "never checked" and let the next save rewrite it.
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !isGatewayGateStatus(record.status)) {
    return null;
  }
  const message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : undefined;
  return {
    version: 1,
    fingerprint: typeof record.fingerprint === "string" && record.fingerprint ? record.fingerprint : null,
    status: record.status,
    checkedAt: readIso(record.checkedAt),
    lastOkAt: readIso(record.lastOkAt),
    ...(message ? { message } : {}),
  };
}

/**
 * What `saveGateState` reports back. `persisted: false` means the verdict exists only in this
 * reply — the next process to ask will read "never checked".
 */
export type SaveGateStateResult = {
  state: GateState;
  persisted: boolean;
};

export function saveGateState(tenantId: string, state: GateState): SaveGateStateResult {
  // A fingerprint is a SHA-256 prefix, never the key, so this file is safe at rest next to settings.enc.
  // Written to a sibling temp file and renamed: a crash mid-write must not leave a half verdict that
  // `loadGateState` would read as "never checked".
  const path = statePath(tenantId);
  const temp = `${path}.tmp`;
  try {
    mkdirSync(tenantDataDir(tenantId), { recursive: true });
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temp, path);
    return { state, persisted: true };
  } catch (error) {
    // Swallow-and-warn, exactly like `clearGateState`. A read-only data dir, a full disk or a
    // directory squatting on the path costs us a cached verdict and nothing else: `loadGateState`
    // then reads "never checked" and `deriveGatewayGate` opens the gate on trust. It must never be
    // the reason a key the owner just pasted comes back as a failed save.
    console.warn(`could not persist the gateway verdict: ${redactSecrets(errorText(error))}`);
    try {
      unlinkSync(temp);
    } catch {
      // A leftover `gateway-gate.json.tmp` is inert and gitignored; there is nothing to recover.
    }
  }
  return { state, persisted: false };
}

export function clearGateState(scope?: SettingsScope): void {
  const path = statePath(resolveSettingsScope(scope).tenantId);
  if (!existsSync(path)) {
    return;
  }
  try {
    unlinkSync(path);
  } catch {
    // Nothing to do: a stale verdict for a key that is gone derives as "needs_key" anyway.
  }
}

function payload(
  endpoint: string,
  status: GatewayGateStatus,
  allowed: boolean,
  grace: boolean,
  checkedAt: string | null,
  lastOkAt: string | null,
  message?: string,
): GatewayGatePayload {
  return {
    status,
    allowed,
    grace,
    endpoint,
    endpointLocked: true,
    checkedAt,
    lastOkAt,
    ...(message ? { message } : {}),
  };
}

/**
 * Age of an ISO timestamp in milliseconds, or null when there is nothing to measure.
 * A negative age means the clock moved backwards (a DST fix, an NTP jump, a VM restore); that is
 * not the owner's fault, so it is clamped to 0 rather than read as "expired".
 */
function ageMs(at: string | null, now: Date): number | null {
  if (!at) {
    return null;
  }
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(0, now.getTime() - parsed);
}

/** True when `lastOkAt` is inside the grace window. Exactly `graceMs` old still counts. */
function withinGrace(lastOkAt: string | null, now: Date, graceMs: number): boolean {
  const age = ageMs(lastOkAt, now);
  return age !== null && age <= graceMs;
}

/** True when an `ok` verdict is still fresh enough to stand on its own. */
function withinOkTtl(checkedAt: string | null, now: Date, okTtlMs: number): boolean {
  const age = ageMs(checkedAt, now);
  return age !== null && age <= okTtlMs;
}

/**
 * The whole decision, in one pure function. Order matters:
 * stub runtime → no key → no verdict for *this* key → the saved verdict, aged against its TTL.
 *
 * The only rules that close the gate are the ones the gateway actually answered: no key at all, a
 * rejected key, or a failure with no successful check inside the grace window. Silence — nothing
 * checked yet — opens it on a desk, because a desk that worked yesterday must not stop working
 * because a new build wants a verdict it has not had a chance to fetch. In server mode
 * (`isServerMode(input.env)`) silence closes it instead: a hosted tenant has no first run to trust,
 * and `maybeRefreshGateway` turns that into a real verdict on the next settings read.
 */
export function deriveGatewayGate(input: DeriveGatewayGateInput): GatewayGatePayload {
  const { endpoint, now } = input;
  const graceMs = input.graceMs ?? GATEWAY_GRACE_MS;
  const okTtlMs = input.okTtlMs ?? GATEWAY_OK_TTL_MS;

  const serverMode = isServerMode(input.env ?? process.env);
  // Cloud, Playwright and the unit suites have no key and must keep working. On the hosted server
  // the stub runtime is a misconfiguration, never an open gate.
  if (input.envRuntime === "stub" && !serverMode) {
    return payload(endpoint, "stub", true, false, null, null);
  }
  if (!input.hasKey || input.envRuntime === "stub") {
    return payload(endpoint, "needs_key", false, false, null, null);
  }

  // Hosted: nothing is taken on trust, so "no verdict for this key" is a closed gate rather than an
  // open one. Everything below this line is a verdict the gateway actually gave, and reads the same
  // on a desk and on the server — including the grace window, which needs a real `lastOkAt`.
  const unverified = serverMode
    ? payload(endpoint, "error", false, false, null, null, GATEWAY_UNVERIFIED_MESSAGE)
    : payload(endpoint, "ok", true, true, null, null, GATEWAY_UNCHECKED_MESSAGE);

  const state = input.state;
  // No verdict, or one that belongs to a key the owner has replaced. This is every install that
  // upgraded into the gate, so on a desk it must not lock anyone out: the key is taken on trust and
  // `maybeRefreshGateway` validates it in the background. A real rejection arrives as invalid_key.
  if (!state || state.fingerprint !== input.fingerprint) {
    return unverified;
  }

  if (state.status === "ok") {
    // Fresh enough to stand on its own; past the TTL it keeps the desk open on grace only, so a key
    // revoked upstream stops working a day later rather than never.
    if (withinOkTtl(state.checkedAt ?? state.lastOkAt, now, okTtlMs)) {
      return payload(endpoint, "ok", true, false, state.checkedAt, state.lastOkAt);
    }
    const allowed = withinGrace(state.lastOkAt, now, graceMs);
    return payload(endpoint, "ok", allowed, true, state.checkedAt, state.lastOkAt);
  }
  // A key the gateway rejected never gets grace: the answer was not "we could not ask".
  if (state.status === "invalid_key") {
    return payload(endpoint, "invalid_key", false, false, state.checkedAt, state.lastOkAt, state.message);
  }
  if (state.status === "unreachable" || state.status === "error") {
    const allowed = withinGrace(state.lastOkAt, now, graceMs);
    return payload(endpoint, state.status, allowed, allowed, state.checkedAt, state.lastOkAt, state.message);
  }
  // A persisted "stub" / "needs_key" is not a verdict about this key, so it reads as "never checked".
  return unverified;
}

/**
 * The gateway URL this desk actually calls. Exactly what every real model call resolves to:
 * `resolveProviderKeys` pins `openaiBaseUrl`, so a hand-edited `settings.openaiBaseUrl` can neither
 * re-point a model call nor the live check that decides whether model calls are allowed.
 */
export function gatewayEndpointFor(settings: StoredSecrets): string {
  return resolveProviderKeys(settings).openaiBaseUrl ?? resolvedGatewayBaseUrl();
}

/**
 * One live validation of `key` against `baseUrl`. Cheapest authenticated endpoint the gateway has.
 * The key is sent as a bearer token and never logged, echoed or written to disk.
 */
export async function checkGatewayLive(input: {
  key: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<GatewayCheckResult> {
  assertAllowedEndpointUrl(input.baseUrl);
  const url = `${input.baseUrl.trim().replace(/\/+$/, "")}/models`;
  const fetchFn = input.fetchImpl ?? fetch;
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetchFn(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.key}`,
      },
      signal: AbortSignal.timeout(input.timeoutMs ?? GATEWAY_CHECK_TIMEOUT_MS),
    });
    if (response.ok) {
      return { status: "ok", checkedAt };
    }
    if (response.status === 401 || response.status === 403) {
      return { status: "invalid_key", checkedAt, message: `HTTP ${response.status}` };
    }
    return { status: "error", checkedAt, message: `HTTP ${response.status}` };
  } catch (error) {
    // Timeout, abort, DNS, TLS, offline: we could not ask, so this is not a verdict on the key.
    const detail = error instanceof Error ? error.message : "Gateway unreachable";
    return { status: "unreachable", checkedAt, message: redactSecrets(detail) };
  }
}

/**
 * The key the gate judges: the one the owner saved, else `OPENAI_API_KEY` — but only on a desk that
 * asked for the live runtime. `resolveProviderKeys` would hand back the env key unconditionally, and
 * on a dev box with a stray export that turned "forget my key" into `error` instead of `needs_key`.
 */
function keyFor(settings: StoredSecrets, envRuntime: string | undefined): string | undefined {
  const saved = settings.openaiApiKey?.trim();
  if (saved) {
    return saved;
  }
  if (envRuntime !== "ai") {
    return undefined;
  }
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  return fromEnv || undefined;
}

/** The current gate for this desk, derived from the saved verdict. No network, no throw. */
export function reportGatewayGate(settings: StoredSecrets, opts: GatewayGateOptions = {}): GatewayGatePayload {
  const envRuntime = opts.envRuntime ?? process.env.AGENTFORGE_RUNTIME;
  const key = keyFor(settings, envRuntime);
  return deriveGatewayGate({
    envRuntime,
    hasKey: Boolean(key),
    fingerprint: keyFingerprintOrNull(key),
    endpoint: gatewayEndpointFor(settings),
    state: loadGateState(tenantOf(opts)),
    now: opts.now ?? new Date(),
    graceMs: opts.graceMs,
    okTtlMs: opts.okTtlMs,
    env: opts.env,
  });
}

/** English, redacted, and specific enough that a support ticket says which rule closed the gate. */
const BLOCKED_MESSAGES: Record<GatewayGateStatus, string> = {
  stub: "The gateway is not available on this desk.",
  needs_key: "No gateway key is saved on this machine.",
  ok: "The saved gateway key has not been validated recently.",
  invalid_key: "The gateway rejected the saved key.",
  unreachable: "The gateway could not be reached, and the offline grace period has ended.",
  error: "The saved gateway key could not be validated.",
};

/**
 * A blocked gateway call. Carries the gate status so `jsonError` can answer with the flat body the
 * renderer parses (`parseGatewayBlocked` reads `error === "gateway_blocked"` at the top level),
 * rather than the usual `{ error: { code, message } }` envelope.
 */
export class GatewayBlockedError extends ApiError {
  readonly gateStatus: GatewayGateStatus;

  constructor(gate: GatewayGatePayload) {
    const base = BLOCKED_MESSAGES[gate.status];
    super("gateway_blocked", gate.message ? `${base} ${gate.message}` : base, 403);
    this.name = "GatewayBlockedError";
    this.gateStatus = gate.status;
  }
}

export function isGatewayBlockedError(error: unknown): error is GatewayBlockedError {
  return error instanceof GatewayBlockedError;
}

/**
 * The host-side enforcement point. Every route that reaches the gateway calls this first, so a
 * closed gate is a 403 from the host and not something the renderer could route around. Stub
 * runtime derives `allowed: true`, so Playwright and Cloud never see it.
 */
export function requireGatewayAllowed(settings: StoredSecrets, opts: GatewayGateOptions = {}): GatewayGatePayload {
  const gate = reportGatewayGate(settings, opts);
  if (!gate.allowed) {
    throw new GatewayBlockedError(gate);
  }
  return gate;
}

/**
 * The spelling every route should use: one argument, and the tenant reaches both the settings file
 * and the verdict file. `requireGatewayAllowedFor(tenant)` — the pre-Phase-3
 * form — reads the local tenant's key and the local tenant's verdict whoever is calling.
 */
export function requireGatewayAllowedFor(
  tenant: Pick<TenantContext, "tenantId" | "workspaceId">,
  opts: Omit<GatewayGateOptions, "tenant"> = {},
): GatewayGatePayload {
  return requireGatewayAllowed(loadSettings(tenant), { ...opts, tenant });
}

/**
 * Validate the saved key against the gateway and persist the verdict, then report the fresh gate.
 * `lastOkAt` survives a failed check of the *same* key — that is what grace is made of — and is
 * dropped the moment the key changes. Never throws: the worst case is a persisted `unreachable`.
 */
export async function runGatewayCheck(
  settings: StoredSecrets,
  opts: GatewayGateOptions = {},
): Promise<GatewayGatePayload> {
  const envRuntime = opts.envRuntime ?? process.env.AGENTFORGE_RUNTIME;
  const key = keyFor(settings, envRuntime);
  // Stub runtime and "no key saved" are decided without asking anyone.
  if (envRuntime === "stub" || !key) {
    return reportGatewayGate(settings, opts);
  }

  const tenantId = tenantOf(opts);
  const fingerprint = keyFingerprintOrNull(key);
  const previous = loadGateState(tenantId);
  let result: GatewayCheckResult;
  try {
    result = await checkGatewayLive({
      key,
      baseUrl: gatewayEndpointFor(settings),
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    });
  } catch (error) {
    // A rejected endpoint URL or a fetch implementation that blew up: same meaning as offline.
    const detail = error instanceof Error ? error.message : "Gateway unreachable";
    result = { status: "unreachable", checkedAt: new Date().toISOString(), message: redactSecrets(detail) };
  }

  const carriedOkAt = previous?.fingerprint === fingerprint ? (previous?.lastOkAt ?? null) : null;
  const { persisted } = saveGateState(tenantId, {
    version: 1,
    fingerprint,
    status: result.status,
    checkedAt: result.checkedAt,
    lastOkAt: result.status === "ok" ? result.checkedAt : carriedOkAt,
    ...(result.message ? { message: result.message } : {}),
  });
  const gate = reportGatewayGate(settings, opts);
  if (persisted) {
    return gate;
  }
  // The verdict was reached but could not be stored, so `reportGatewayGate` has just re-read a data
  // dir that still says "never checked". Say so instead of reporting a confident verdict that will
  // have evaporated by the next request. `allowed` is left untouched: a disk that will not take the
  // file is not a key the gateway rejected, and it must not close the desk.
  return { ...gate, status: "error", message: GATEWAY_VERDICT_UNWRITABLE_MESSAGE };
}

/** Last background re-check per tenant and fingerprint, for this process only. Cleared by the tests. */
const refreshedAt = new Map<string, number>();

/** Test seam: forget the throttle so the next `maybeRefreshGateway` may fire again. */
export function resetGatewayRefreshThrottle(): void {
  refreshedAt.clear();
}

/** (a) no verdict for this key, or (b) the `ok` verdict has aged past the TTL. */
function needsGatewayRefresh(state: GateState | null, fingerprint: string | null, now: Date, okTtlMs: number): boolean {
  if (!state || state.fingerprint !== fingerprint) {
    return true;
  }
  if (state.status === "ok") {
    return !withinOkTtl(state.checkedAt ?? state.lastOkAt, now, okTtlMs);
  }
  return false;
}

/**
 * Fire-and-forget re-validation, called from `GET /api/v1/settings`.
 *
 * Existing installs carry a key no verdict was ever written for, and a verdict goes stale after a day;
 * both are opened on trust by `deriveGatewayGate`, so something has to actually ask the gateway. This
 * is that something: it never blocks the response, never throws, and runs at most once every ten
 * minutes per key per process. Returns whether a check was started, which is what the tests assert.
 */
export function maybeRefreshGateway(settings: StoredSecrets, opts: MaybeRefreshGatewayOptions = {}): boolean {
  const envRuntime = opts.envRuntime ?? process.env.AGENTFORGE_RUNTIME;
  if (envRuntime === "stub") {
    return false;
  }
  const key = keyFor(settings, envRuntime);
  if (!key) {
    return false;
  }
  const nowMs = opts.nowMs?.() ?? Date.now();
  const tenantId = tenantOf(opts);
  const fingerprint = keyFingerprintOrNull(key);
  // Keyed by tenant as well as key: two tenants that happen to share a key must each get a check,
  // because each writes its own verdict file.
  const slot = `${tenantId}:${fingerprint ?? ""}`;
  const last = refreshedAt.get(slot);
  if (last !== undefined && nowMs - last < (opts.throttleMs ?? GATEWAY_REFRESH_THROTTLE_MS)) {
    return false;
  }
  const now = opts.now ?? new Date(nowMs);
  if (!needsGatewayRefresh(loadGateState(tenantId), fingerprint, now, opts.okTtlMs ?? GATEWAY_OK_TTL_MS)) {
    return false;
  }
  refreshedAt.set(slot, nowMs);
  const check = opts.runCheck ?? runGatewayCheck;
  try {
    // Started here and never awaited: the caller is a request handler that must not wait on a network
    // round trip. `runGatewayCheck` persists `unreachable` rather than throwing; the rest is belt and braces.
    void check(settings, {
      tenant: opts.tenant,
      envRuntime,
      fetchImpl: opts.fetchImpl,
      timeoutMs: opts.timeoutMs,
    }).catch(() => undefined);
  } catch {
    // A check that threw synchronously is still not the settings response's problem.
  }
  return true;
}
