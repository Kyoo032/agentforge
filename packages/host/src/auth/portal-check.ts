/**
 * The host's standing question to the portal: does it still vouch for this browser session?
 *
 * Before this, the session gate (`../router.ts` → `./routes.ts` `requireSessionFor`) trusted the
 * host's own `auth_sessions` row for up to 12 h idle and 30 days absolute, and nothing called the
 * portal after sign-in. A session the portal revoked, a user it disabled, a device an admin signed
 * out or an organisation that fell past due all kept working here until the row idled out.
 *
 * The portal has no "is this session live" call the host can make with what it holds, but it does
 * answer a refresh: `POST /auth/token` with `grant_type=refresh_token` runs the same login checks
 * and refuses with the reason. So once the portal's last word on a session is older than
 * `PORTAL_CHECK_INTERVAL_MS`, the gate rotates the refresh token and:
 *
 *   - **rotated** → the new pair goes to the vault exactly as sign-in puts it there, and the new
 *     refresh token is sealed onto the row in the same write that moves `portalCheckedAt` forward;
 *   - **a terminal reason** (`TERMINAL_PORTAL_REASONS`) → the session ends here: revoked in the
 *     store, its tokens dropped (the sealed one with the revocation), and the request answered 401
 *     with the portal's own reason;
 *   - **no answer** (unreachable, timed out, rate-limited, misrouted, or the portal refusing this
 *     deployment's own client) → the session stands. Boot and every request after it never wait on
 *     the network for long (`PORTAL_CHECK_WAIT_MS`), and a failed check is not asked again for
 *     `PORTAL_CHECK_RETRY_MS`;
 *   - **nothing usable to present** → the session ends with `refresh_expired`, the same answer
 *     `POST /auth/refresh` has always given: a session the host can no longer check with the portal
 *     is not one it may keep vouching for. That is no token in the vault AND none sealed on the row,
 *     or a sealed one that does not open under this wrap key (changed without the rotation drill).
 *
 * A RESTART SIGNS NOBODY OUT (owner decision 2026-09-23). The vault is process memory, so a restart
 * empties it; the first check afterwards opens the refresh token sealed on the row
 * (`./session-secrets.ts`) and refreshes with it. Every refresh presents the deployment's
 * confidential client when one is configured, so the portal counts the host against the client
 * rather than against the one address every hosted session refreshes from.
 *
 * ONE REFRESH AT A TIME PER SESSION, WHOEVER ASKS. The portal rotates on every refresh and treats a
 * spent token presented again as theft: it revokes the whole chain (`rotate_refresh_token`,
 * docs/internal/portal/migrations/0005_functions.sql). Two requests racing through the gate, or the
 * gate racing a sign-out, would do exactly that with one token. So `refresh` is single-flight per
 * session id and the gate, `POST /auth/refresh` and `POST /auth/logout` all go through it.
 *
 * A REFRESH NOBODY IS WAITING FOR STILL LANDS. The request stops waiting after
 * `PORTAL_CHECK_WAIT_MS`, but the call keeps the portal client's own 5 s budget and its answer is
 * applied when it comes: the rotated token is kept (dropping it would make the next check a replay)
 * and a terminal answer still ends the session, so the next request is refused.
 *
 * Tokens never leave this module except into the vault and back to the one caller that asked for
 * them (sign-out). No verdict, log line or error carries one.
 */
import { getLocalVaultKey } from "@agentforge/db/vault-key";
import { log } from "../log";
import { PortalError, type PortalClient } from "./portal-client";
import type { PortalClientCredentials } from "./portal-config";
import { portalCheckDue, revokedSession, type AuthReason, type SessionRecord } from "./session";
import { createSessionSecrets, type SessionSecrets } from "./session-secrets";
import type { PortalTokenSet, SessionStore, TokenVault } from "./session-store";

/**
 * How long a request waits on a due check before going ahead on the session it has. Short on
 * purpose: a healthy portal answers in milliseconds, and a slow one must not make every page slow.
 */
export const PORTAL_CHECK_WAIT_MS = 2000;
/** After a check the portal did not answer, how long before a request for that session asks again. */
export const PORTAL_CHECK_RETRY_MS = 60 * 1000;
/** The ceiling on the portal's own `retry_after`, so one bad value cannot switch the check off. */
const MAX_RETRY_MS = 15 * 60 * 1000;
/** Back-off entries kept at most; oldest first out. One per session that met an outage. */
const MAX_BACKOFF_ENTRIES = 10_000;

/**
 * The portal's answers that mean this session is over (docs/internal/portal/device-code-login.md
 * :222 and the table at :409-423). `invalid_grant` is here because `mapPortalError` only produces
 * it for a body in the portal's own error shape.
 *
 * Deliberately absent: `portal_unavailable` (nobody answered), `invalid_request` (the portal
 * narrows a rate-limited `/auth/token` to it, at 429, and it is otherwise a malformed request —
 * neither says anything about the session) and `session_required` (the host's own code).
 */
export const TERMINAL_PORTAL_REASONS: ReadonlySet<AuthReason> = new Set<AuthReason>([
  "tenant_inactive",
  "org_inactive",
  "org_past_due",
  "user_inactive",
  "seat_cap_reached",
  "device_revoked",
  "session_revoked",
  "refresh_reused",
  "refresh_expired",
  "invalid_grant",
]);

export function isTerminalPortalReason(reason: AuthReason): boolean {
  return TERMINAL_PORTAL_REASONS.has(reason);
}

/** Which store and clock the caller works against: the router may be handed its own for a test. */
export type PortalCheckContext = {
  readonly store: SessionStore;
  readonly now?: () => number;
};

export type PortalRefreshOutcome =
  /** Rotated: the new pair is in the vault, sealed on the row, and the check is stamped. */
  | { readonly kind: "rotated"; readonly tokens: PortalTokenSet & { readonly accessToken: string } }
  /** The portal ended the session: already revoked here, tokens already dropped. */
  | { readonly kind: "ended"; readonly error: PortalError }
  /**
   * Nothing usable to present to the portal — no token held, or a stored one that does not open
   * under this wrap key: already revoked here as `refresh_expired`.
   */
  | { readonly kind: "no_tokens" }
  /** The portal said nothing about this session. It stands, and the next check backs off. */
  | { readonly kind: "unanswered"; readonly error: PortalError };

export type PortalGateVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AuthReason; readonly message: string | null };

export interface PortalSessionCheck {
  /** Rotate this session's portal tokens. Single-flight per session; never rejects. */
  refresh(session: SessionRecord, context: PortalCheckContext): Promise<PortalRefreshOutcome>;
  /** The gate: ask only when due and not backing off, and wait on the answer for a bounded time. */
  gate(session: SessionRecord, context: PortalCheckContext): Promise<PortalGateVerdict>;
}

export type PortalSessionCheckOptions = {
  /** This process's working copy of the tokens: the access token lives only here. */
  readonly vault: TokenVault;
  readonly portal: PortalClient;
  /**
   * Seals the refresh token onto the session row and opens it after a restart
   * (`./session-secrets.ts`). Defaults to the wrap key this process runs under.
   */
  readonly secrets?: SessionSecrets;
  /**
   * The deployment's confidential client, presented on every refresh so the portal counts the
   * host's traffic against the client and not against the one address it all comes from. The
   * same two values the code exchange sends (`portalClientCredentials`). Absent, or answering
   * null, the refresh goes without them, as it did before.
   */
  readonly clientCredentials?: () => PortalClientCredentials | null;
  readonly waitMs?: number;
  readonly retryMs?: number;
};

/** `held` when the vault or the row has a token to present, or why there is none. */
type Held = PortalTokenSet | "none" | "unreadable";

const TIMED_OUT = Symbol("timed_out");

/** `promise`, or `TIMED_OUT` after `ms`. The timer never holds the process open. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An error as a log field, without leaking what it was carrying. A failed drizzle query puts its
 * bound parameters into its own message (`Failed query: … params: …`), and the writes here bind a
 * sealed refresh token and a session's id digest. So an error that carries `params` is named, with
 * the SQLite code of its cause, and never quoted; any other is quoted, because a missing wrap key or
 * an unreachable portal is exactly what an operator needs to read.
 */
export function faultOf(error: unknown): { name: string; code: string | null; detail?: string } {
  const record = (typeof error === "object" && error !== null ? error : {}) as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    params?: unknown;
    cause?: { code?: unknown } | null;
  };
  const name = typeof record.name === "string" ? record.name : "unknown";
  const rawCode = record.cause?.code ?? record.code;
  const code = typeof rawCode === "string" ? rawCode : null;
  if ("params" in record || typeof record.message !== "string") {
    return { name, code };
  }
  return { name, code, detail: record.message };
}

/**
 * Anything the portal client throws, as a reason. A `PortalError` is already one; anything else —
 * the lazy client refusing to build without `AGENTFORGE_PORTAL_URL` — is a portal nobody can reach.
 */
function asPortalError(error: unknown): PortalError {
  return error instanceof PortalError ? error : new PortalError("portal_unavailable", 503);
}

export function createPortalSessionCheck(options: PortalSessionCheckOptions): PortalSessionCheck {
  const waitMs = options.waitMs ?? PORTAL_CHECK_WAIT_MS;
  const retryMs = options.retryMs ?? PORTAL_CHECK_RETRY_MS;
  const secrets = options.secrets ?? createSessionSecrets(() => getLocalVaultKey());

  /** The client to authenticate as, or none. A source that throws is read as none, never a crash. */
  function clientCredentials(): PortalClientCredentials | null {
    try {
      return options.clientCredentials?.() ?? null;
    } catch {
      return null;
    }
  }
  /** Keyed by the cookie's id, process memory only, like the vault beside it. */
  const inFlight = new Map<string, Promise<PortalRefreshOutcome>>();
  const retryAt = new Map<string, number>();

  function backOff(sessionId: string, now: number, refusal: PortalError): void {
    const hinted = (refusal.retryAfter ?? 0) * 1000;
    retryAt.delete(sessionId);
    retryAt.set(sessionId, now + Math.min(Math.max(retryMs, hinted), MAX_RETRY_MS));
    while (retryAt.size > MAX_BACKOFF_ENTRIES) {
      const oldest = retryAt.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      retryAt.delete(oldest);
    }
  }

  function backingOff(sessionId: string, now: number): boolean {
    const until = retryAt.get(sessionId);
    if (until === undefined) {
      return false;
    }
    if (now >= until) {
      retryAt.delete(sessionId);
      return false;
    }
    return true;
  }

  /** Revoked here and its tokens dropped. A failed write is logged; the caller is refused either way. */
  async function end(session: SessionRecord, context: PortalCheckContext): Promise<void> {
    retryAt.delete(session.id);
    await options.vault.delete(session.id);
    try {
      await context.store.save(revokedSession(session, (context.now ?? Date.now)()));
    } catch (error) {
      log.error("portal_session_end_not_recorded", { tenantId: session.tenantId, fault: faultOf(error) });
    }
  }

  /**
   * The tokens to present: the vault's, or — the first check after a restart — the refresh token
   * sealed on the row, opened and put back in the vault (with no access token until this rotation
   * lands). A wrap key that cannot be read at all throws out of `secrets.open` on purpose: that is
   * the deployment, not the session, and `refresh` answers it as no answer.
   */
  async function heldTokens(session: SessionRecord, context: PortalCheckContext): Promise<Held> {
    const cached = await options.vault.get(session.id);
    if (cached) {
      return cached;
    }
    const sealed = await context.store.readRefreshSealed(session.id);
    if (sealed === null) {
      return "none";
    }
    const opened = secrets.open(session.id, sealed);
    if (!opened) {
      return "unreadable";
    }
    const warmed: PortalTokenSet = { refreshToken: opened.refreshToken, accessToken: null, deviceId: opened.deviceId };
    await options.vault.put(session.id, warmed);
    return warmed;
  }

  /**
   * The rotated refresh token, sealed for the row. `null` when it cannot be sealed, which clears
   * the stored copy: the token on the row has just been spent at the portal, and presenting it
   * after a restart would read there as token theft. Losing the at-rest copy costs one sign-in.
   */
  function sealRotated(session: SessionRecord, rotated: PortalTokenSet): string | null {
    try {
      return secrets.seal(session.id, { refreshToken: rotated.refreshToken, deviceId: rotated.deviceId });
    } catch (error) {
      log.error("session_refresh_not_sealed", { tenantId: session.tenantId, fault: faultOf(error) });
      return null;
    }
  }

  async function run(session: SessionRecord, context: PortalCheckContext): Promise<PortalRefreshOutcome> {
    const clock = context.now ?? Date.now;
    const held = await heldTokens(session, context);
    if (held === "none" || held === "unreadable") {
      await end(session, context);
      log.warn("portal_session_ended", {
        code: "refresh_expired",
        tenantId: session.tenantId,
        cause: held === "none" ? "no_tokens" : "unreadable",
      });
      return { kind: "no_tokens" };
    }
    let rotated: PortalTokenSet & { readonly accessToken: string };
    try {
      const client = clientCredentials();
      const answer = await options.portal.refresh({
        refreshToken: held.refreshToken,
        deviceId: held.deviceId,
        ...(client ? { clientId: client.clientId, clientSecret: client.clientSecret } : {}),
      });
      rotated = {
        refreshToken: answer.refreshToken,
        accessToken: answer.accessToken,
        // The server-side device id is sent on every refresh; an answer that omits it must not
        // lose the one the next refresh has to present.
        deviceId: answer.deviceId ?? held.deviceId,
      };
    } catch (caught) {
      const refusal = asPortalError(caught);
      if (isTerminalPortalReason(refusal.reason)) {
        await end(session, context);
        log.warn("portal_session_ended", { code: refusal.reason, tenantId: session.tenantId });
        return { kind: "ended", error: refusal };
      }
      backOff(session.id, clock(), refusal);
      if (refusal.rfcError === "invalid_client") {
        // The portal refused THIS DEPLOYMENT's client id or secret: an operator's fix, and every
        // session keeps working meanwhile. Named, never the value.
        log.error("portal_client_rejected", {
          rfcError: refusal.rfcError,
          status: refusal.status,
          tenantId: session.tenantId,
        });
      } else {
        log.warn("portal_check_unanswered", {
          code: refusal.reason,
          status: refusal.status,
          rfcError: refusal.rfcError,
          tenantId: session.tenantId,
          ...(caught instanceof PortalError ? {} : { error: caught }),
        });
      }
      return { kind: "unanswered", error: refusal };
    }
    // Before anything else can fail: the portal has already spent the token we presented.
    await options.vault.put(session.id, rotated);
    retryAt.delete(session.id);
    try {
      // One write: the sealed token and the stamp can never disagree about which rotation they
      // belong to, and a row revoked meanwhile keeps neither token.
      await context.store.recordRotation(session.id, clock(), sealRotated(session, rotated));
    } catch (error) {
      // The pair is safe in the vault until a restart. The row still holds the token just spent,
      // so a restart before the next rotation ends this session at the portal as a replay.
      log.error("portal_check_not_recorded", { tenantId: session.tenantId, fault: faultOf(error) });
    }
    return { kind: "rotated", tokens: rotated };
  }

  function refresh(session: SessionRecord, context: PortalCheckContext): Promise<PortalRefreshOutcome> {
    const running = inFlight.get(session.id);
    if (running) {
      return running;
    }
    const started = run(session, context)
      .catch((error: unknown): PortalRefreshOutcome => {
        // Only the vault, the store or an unreadable wrap key can get here, never the portal:
        // treat it as no answer, and back off so a broken deployment is not asked on every request.
        const unavailable = new PortalError("portal_unavailable", 503);
        backOff(session.id, (context.now ?? Date.now)(), unavailable);
        log.error("portal_check_failed", { tenantId: session.tenantId, fault: faultOf(error) });
        return { kind: "unanswered", error: unavailable };
      })
      .finally(() => {
        inFlight.delete(session.id);
      });
    inFlight.set(session.id, started);
    return started;
  }

  async function gate(session: SessionRecord, context: PortalCheckContext): Promise<PortalGateVerdict> {
    const now = (context.now ?? Date.now)();
    if (!portalCheckDue(session, now) || backingOff(session.id, now)) {
      return { ok: true };
    }
    const outcome = await within(refresh(session, context), waitMs);
    if (outcome === TIMED_OUT) {
      // Still running, and it will apply its own answer when it comes. This request goes ahead.
      log.info("portal_check_slow", { tenantId: session.tenantId, waitMs });
      return { ok: true };
    }
    switch (outcome.kind) {
      case "ended":
        return { ok: false, reason: outcome.error.reason, message: outcome.error.messageEn };
      case "no_tokens":
        return { ok: false, reason: "refresh_expired", message: null };
      default:
        return { ok: true };
    }
  }

  return { refresh, gate };
}
