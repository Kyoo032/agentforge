/**
 * The host half of the gateway key gate.
 *
 * The host decides, the renderer displays: `allowed` is the only thing the renderer branches on,
 * and it never re-derives a decision from `hasOpenai` or key shape. The contract is
 * `GatewayGatePayload` in `@agentforge/core` (`gateway/gate-types.ts`).
 *
 * Split in two on purpose: `deriveGatewayGate` is pure (every rule is unit-testable with no disk
 * and no network), and the rest is the IO around it — one stored verdict per tenant, held by
 * `tenant-state-store.ts` (a file on a desk, a `tenant_state` row on the hosted server), and one
 * live call to the gateway on a 3 s budget.
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
import { TENANT_STATE_FILENAMES, tenantStateBackend } from "./tenant-state-store";
import { requireEntitlementAllowed } from "./entitlement-store";
import { loadSettings, resolveSettingsScope, type SettingsScope } from "./settings-store";

/**
 * The desktop's filename for the verdict, and still exactly that on a desk. Phase 4 put the payload
 * behind `tenant-state-store.ts`, which maps the `gateway_gate` key back to this name on the file
 * backend and to a `tenant_state` row on the hosted server. Re-exported rather than re-spelled, so
 * there is exactly one module in the host that knows what a desk's files are called — which is what
 * the guard in `tenant-state.test.ts` checks. Still exported because the tests assert the desktop
 * layout by path.
 */
export const GATEWAY_GATE_FILE = TENANT_STATE_FILENAMES.gateway_gate;

/** Phase 4 — which payload this module owns. See `tenant-state-store.ts` for what a key means. */
const GATE_KEY = "gateway_gate" as const;

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
    const stored = tenantStateBackend().read(tenantId, GATE_KEY);
    if (!stored) {
      return null;
    }
    parsed = JSON.parse(stored.value) as unknown;
  } catch {
    // Absent, unreadable or not JSON: treat as "never checked" and let the next save rewrite it.
    // A verdict is a cache of something the gateway said, so losing one costs a re-check and
    // nothing else — the opposite of the sealed settings payload, which refuses rather than reset.
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
  // A fingerprint is a SHA-256 prefix, never the key, so this payload is safe at rest beside the
  // sealed settings. The atomic temp-file-and-rename this used to do itself now belongs to the file
  // backend, and the row backend writes one statement, so neither can leave half a verdict.
  try {
    tenantStateBackend().write(tenantId, GATE_KEY, `${JSON.stringify(state, null, 2)}\n`);
    return { state, persisted: true };
  } catch (error) {
    // Swallow-and-warn, exactly like `clearGateState`. A read-only data dir, a full disk or a
    // locked database costs us a cached verdict and nothing else: `loadGateState` then reads
    // "never checked" and `deriveGatewayGate` opens the gate on trust. It must never be the reason
    // a key the owner just pasted comes back as a failed save.
    console.warn(`could not persist the gateway verdict: ${redactSecrets(errorText(error))}`);
  }
  return { state, persisted: false };
}

export function clearGateState(scope?: SettingsScope): void {
  try {
    tenantStateBackend().remove(resolveSettingsScope(scope).tenantId, GATE_KEY);
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
      // The key rides this request, and the default "follow" would replay it to whatever host a 3xx
      // names (docs/internal/security-owasp-2026-09.md, A10-4). The base URL is pinned, so a
      // redirect is never something this app asked for: it arrives below as a non-ok status and is
      // reported as "could not ask", which is the honest verdict.
      redirect: "manual",
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
 * The key the gate judges: the one the tenant saved, else `OPENAI_API_KEY` — but only on a desk
 * that asked for the live runtime, and never on the hosted server.
 *
 * Two separate refusals, for two separate reasons. `envRuntime !== "ai"` is the older one: a dev
 * box with a stray export would otherwise turn "forget my key" into `error` instead of `needs_key`.
 * Server mode is Phase 4's: a process-wide key there belongs to the OPERATOR, and a tenant who has
 * saved none must be told to save one rather than quietly spending the operator's credit — the same
 * rule `resolveProviderKeys` now enforces on the call path, applied here so the gate's verdict and
 * the call agree about whether this tenant has a key at all.
 */
function keyFor(settings: StoredSecrets, envRuntime: string | undefined, env: EnvLike = process.env): string | undefined {
  const saved = settings.openaiApiKey?.trim();
  if (saved) {
    return saved;
  }
  if (envRuntime !== "ai" || isServerMode(env)) {
    return undefined;
  }
  const fromEnv = env.OPENAI_API_KEY?.trim();
  return fromEnv || undefined;
}

/** The current gate for this desk, derived from the saved verdict. No network, no throw. */
export function reportGatewayGate(settings: StoredSecrets, opts: GatewayGateOptions = {}): GatewayGatePayload {
  const envRuntime = opts.envRuntime ?? process.env.AGENTFORGE_RUNTIME;
  const key = keyFor(settings, envRuntime, opts.env);
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
 *
 * **Phase 5 lane B: the plan is checked here too, and it is checked first.**
 *
 * Here, because this is the only choke point before a gateway call and it already takes the
 * tenant — so every call site gained the allowance without one of them changing, directly or
 * through `requireGatewayAllowedFor`, and none of them gained an `await`, which is what the
 * decision doc's §3(a) asked for. `better-sqlite3` is
 * synchronous, so the entitlement read costs no asynchrony; off server mode it costs nothing at
 * all, because `requireEntitlementAllowed` returns before it asks for a connection.
 *
 * First, because the two refusals send the renderer to different screens and only one of them is
 * actionable. A hosted tenant that is past due or out of allowance holds no gateway key of its
 * own, so answering `needs_key` would route it to the paste-your-key onboarding screen — whose
 * only exits are a key, a re-check, or deleting a file on the server's disk (decision doc §3(b)).
 * The plan refusal names the account screen, where paying is possible. On a desk neither ordering
 * is observable: there is no plan.
 */
export function requireGatewayAllowed(settings: StoredSecrets, opts: GatewayGateOptions = {}): GatewayGatePayload {
  requireEntitlementAllowed(tenantOf(opts));
  const gate = reportGatewayGate(settings, opts);
  if (!gate.allowed) {
    throw new GatewayBlockedError(gate);
  }
  return gate;
}

/**
 * The spelling every route should use: one argument, and the tenant reaches both the settings file
 * and the verdict file. The pre-Phase-3 form, `requireGatewayAllowed(loadSettings())`, reads the
 * local tenant's key and the local tenant's verdict whoever is calling.
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
  const key = keyFor(settings, envRuntime, opts.env);
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
  const key = keyFor(settings, envRuntime, opts.env);
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
