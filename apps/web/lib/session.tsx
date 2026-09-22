/**
 * Phase 9 lane C — who is signed in, as the renderer sees it.
 *
 * The host owns the session: an opaque cookie, a row, and a gate that answers `401` to everything
 * else (`docs/internal/maps/portal-session-auth.md`). This module holds the one fact the screens
 * need — signed in, signed out, or not a thing here at all — and the two calls that change it.
 *
 * **Sessions are a property of the deployment, not of the person.** `GET /api/v1/ping` says whether
 * this deployment has them (`capabilities.sessions`, `packages/core/src/capabilities.ts`), and that
 * answer is read from the shared ping rather than from the capabilities context on purpose: React
 * runs a child's effect before its parent's, so a provider mounted under
 * `HostCapabilitiesProvider` cannot tell "ping said no" from "ping has not answered yet" by reading
 * the context. Reading the payload directly makes the boot order the plan asks for — ping, then the
 * session — true by construction, and `pingOnce` is memoised so it is still one request.
 *
 * **Off a hosted deployment this module makes no request.** Webdev and the desktop have no
 * `/api/v1/auth/session` route at all; asking would be a 404 in the console of an app that works.
 *
 * The four statuses are total and each one means one thing:
 *
 * | Status | Meaning | What the app does |
 * |---|---|---|
 * | `unknown` | ping has not answered | the boot screen |
 * | `unavailable` | this deployment has no sessions (webdev, desktop) | nothing — the app as it was |
 * | `signed-in` | a live session, with its identifiers | the app |
 * | `signed-out` | no session, or one the host refused | the sign-in screen |
 *
 * A host that cannot be reached lands on `signed-out` with `portal_unavailable`, **not** on
 * `unavailable`: "unavailable" would open the desk on a box where every call is about to fail,
 * while a sign-in screen carrying "cannot reach the sign-in service" is both honest and the button
 * that retries.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppLocale } from "@agentforge/core/locale";
import { apiFetch } from "@/lib/api-client";
import { isAuthReason, type AuthReason } from "@/lib/auth-reason";
import { capabilitiesFrom } from "@/lib/host-capabilities";
import { pingOnce } from "@/lib/host-ping";
import { onSessionLost } from "@/lib/session-signal";

export const SESSION_PATH = "/api/v1/auth/session";
export const LOGOUT_PATH = "/api/v1/auth/logout";

export type SessionStatus = "unknown" | "signed-out" | "signed-in" | "unavailable";

/** Exactly what `sessionSummary` returns (`packages/host/src/auth/session.ts`). No token, ever. */
export type SessionIdentity = {
  readonly userId: string;
  readonly orgId: string;
  readonly tenantId: string;
  /** Epoch milliseconds, the host's idle expiry. `0` when the host sent nothing usable. */
  readonly expiresAt: number;
};

export type SessionSnapshot = {
  readonly status: SessionStatus;
  readonly identity: SessionIdentity | null;
  /** Why the host says there is no session, when it said. Only ever one of its own codes. */
  readonly reason: AuthReason | null;
};

export type SessionView = SessionSnapshot & {
  /** Revoke the session host-side. The caller decides where the browser goes next. */
  readonly signOut: () => Promise<void>;
};

export const SESSION_BOOTING: SessionSnapshot = Object.freeze({
  status: "unknown",
  identity: null,
  reason: null,
});

export const SESSIONS_OFF: SessionSnapshot = Object.freeze({
  status: "unavailable",
  identity: null,
  reason: null,
});

const SIGNED_OUT: SessionSnapshot = Object.freeze({ status: "signed-out", identity: null, reason: null });

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The host's answer → a snapshot.
 *
 * A `signedIn: true` missing any of the three identifiers is read as signed out. Those ids are what
 * every row this browser writes will belong to; half an identity is somebody else's data waiting to
 * happen, and the recoverable answer is "sign in again".
 */
export function parseSessionPayload(payload: unknown): SessionSnapshot {
  const outer = record(payload);
  if (!outer) {
    return SIGNED_OUT;
  }
  const body = record(outer.body) ?? outer;
  if (body.signedIn !== true) {
    const reason = body.reason;
    return isAuthReason(reason) ? { status: "signed-out", identity: null, reason } : SIGNED_OUT;
  }
  const userId = identifier(body.userId);
  const orgId = identifier(body.orgId);
  const tenantId = identifier(body.tenantId);
  if (!userId || !orgId || !tenantId) {
    return SIGNED_OUT;
  }
  const expiresAt = typeof body.expiresAt === "number" && Number.isFinite(body.expiresAt) ? body.expiresAt : 0;
  return { status: "signed-in", identity: { userId, orgId, tenantId, expiresAt }, reason: null };
}

/**
 * The boot read: ping first, and the session only where there is one to read.
 *
 * Both halves fail closed in the direction that keeps the person able to act — a ping nobody
 * answered means no deployment has claimed to have sessions, which is the desk's behaviour, and a
 * session read that threw means sign in again.
 */
export async function readSessionOnce(): Promise<SessionSnapshot> {
  const capabilities = capabilitiesFrom(await pingOnce());
  if (!capabilities.sessions) {
    return SESSIONS_OFF;
  }
  try {
    const response = await apiFetch(SESSION_PATH);
    return parseSessionPayload(await response.json());
  } catch {
    return { status: "signed-out", identity: null, reason: "portal_unavailable" };
  }
}

/**
 * End the session host-side. Never throws: the browser is on its way to the sign-in screen either
 * way, and the host's logout is idempotent at both ends (`packages/host/src/auth/routes.ts`).
 */
export async function signOutNow(): Promise<void> {
  try {
    await apiFetch(LOGOUT_PATH, { method: "POST" });
  } catch {
    // The cookie may survive a failed call; the next request answers 401 and lands here again.
  }
}

/**
 * What a later `401` does to the snapshot.
 *
 * Only a live session can be lost, and only for a code the host owns. Webdev answers `401` with
 * `unauthorized` while its local owner is being created — that is not a session ending, and a rule
 * that flipped on any 401 would put a sign-in screen on a desk that has none.
 */
export function afterSessionLost(current: SessionSnapshot, code: unknown): SessionSnapshot {
  if (current.status !== "signed-in" || !isAuthReason(code)) {
    return current;
  }
  return { status: "signed-out", identity: null, reason: code };
}

/** What the shell shows. One function, so every screen and every boot fetch reads the same rule. */
export type BootView = "loading" | "sign-in" | "app";

/**
 * Session status → what to render.
 *
 * `unavailable` and `signed-in` are the same answer on purpose: a deployment without sessions is a
 * deployment where everybody is already as signed in as it gets, which is what keeps webdev and the
 * desktop exactly as they were. The one status that must never reach the app is `signed-out` on a
 * hosted box — before this existed a signed-out visitor fell through to `resolveGate` and was shown
 * the paste-your-key onboarding (`apps/web/lib/gateway-gate.ts`), which is not a door they have.
 */
export function bootView(status: SessionStatus): BootView {
  if (status === "unknown") {
    return "loading";
  }
  return status === "signed-out" ? "sign-in" : "app";
}

const LOCALE_TAGS: Record<AppLocale, string> = { en: "en-US", id: "id-ID" };

/** The host's epoch milliseconds as a moment a person reads, or null when there is none. */
export function formatSessionExpiry(expiresAt: number, locale: AppLocale): string | null {
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return null;
  }
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale] ?? LOCALE_TAGS.en, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Nobody outside a provider has a session. The default is the deployment that has none, so a
 * component mounted on its own renders its signed-out branch rather than a boot spinner forever.
 */
const SessionContext = createContext<SessionView>({ ...SESSIONS_OFF, signOut: async () => {} });

export function useSession(): SessionView {
  return useContext(SessionContext);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(SESSION_BOOTING);

  useEffect(() => {
    let live = true;
    void readSessionOnce().then((next) => {
      if (live) {
        setSnapshot(next);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // One subscriber for the whole app: any call that answers 401 with a reason the host owns ends
  // the session here, and the screens follow from the status.
  useEffect(() => onSessionLost((code) => setSnapshot((current) => afterSessionLost(current, code))), []);

  const value = useMemo<SessionView>(
    () => ({
      ...snapshot,
      signOut: async () => {
        await signOutNow();
        setSnapshot(SIGNED_OUT);
      },
    }),
    [snapshot],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Test seam: render a subtree against a known session and no network at all. */
export function SessionFixture({ value, children }: { value: SessionSnapshot; children: ReactNode }) {
  return (
    <SessionContext.Provider value={{ ...value, signOut: async () => {} }}>{children}</SessionContext.Provider>
  );
}
