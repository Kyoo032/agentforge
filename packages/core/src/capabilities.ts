/**
 * Phase 8 — what this deployment can actually do, as one object both sides read.
 *
 * The migration plan's §4 names the shape: "Everything a target cannot do is a **capability**,
 * resolved once at boot and read by both the host and the renderer". Until this phase the renderer
 * decided for itself, with `isElectron()` scattered across nine files, and the host decided
 * separately with `isServerMode()` inside each handler. Those two answers agreed by luck rather
 * than by construction — `isElectron()` is false on webdev too, so every rule the renderer hung on
 * it was really saying "not the packaged app", which is not the same statement as "the hosted
 * server", and no test could tell the two apart.
 *
 * **One function, two readers.** The host resolves this from its own environment and puts it on
 * `GET /api/v1/ping`; the renderer reads it from there and hides what the deployment cannot do.
 * The host still refuses the route itself — a hidden button is a courtesy, never a control — so
 * every flag below that hides something has a refusal behind it with its own error code, and the
 * lane record ties each pair together.
 *
 * **Every flag is a fact about the deployment, never about a tenant.** That is what makes it safe
 * to answer before anyone has signed in: `/api/v1/ping` is one of the two ungated GETs
 * (`packages/host/src/auth/routes.ts`), so onboarding can read it, and an anonymous caller learns
 * only what the login screen already tells them. Nothing here is per tenant, per plan or per user
 * — a plan's allowance is `GET /api/v1/billing/plan`, behind the session, and stays there.
 *
 * `objectStorage` is deliberately a boolean rather than the backend's name: whether a hosted
 * deployment holds its bytes in COS or on its own disk is an operator's business and tells an
 * anonymous caller something about the box. The renderer only ever needs "is there a quota screen
 * to show".
 */
import type { EnvLike } from "./server-mode";
import { isServerMode } from "./server-mode";

/**
 * What a deployment can do. Every field is a fact about the *target*, not about the caller.
 *
 * Deliberately flat and deliberately boolean: a renderer that has to interpret a capability has a
 * rule of its own, and a rule of its own is how the two sides drift apart again.
 */
export type HostCapabilities = {
  /** Browser sessions and sign-in. The hosted server; never the desktop, which has one owner. */
  readonly sessions: boolean;
  /** One owner, resolved from the machine rather than from a session. The desktop and webdev. */
  readonly singleOwner: boolean;
  /** A per-tenant byte ceiling is enforced, so the storage screen has a number to show. */
  readonly storageQuota: boolean;
  /** Tenant bytes go through the Phase 6 object store with a per-tenant prefix. */
  readonly objectStorage: boolean;
  /** Plans, allowances and top-ups (Phase 5 lane B). Hosted only. */
  readonly plans: boolean;
  /** The shell can restart itself. Packaged Electron only; nothing else has a shell to ask. */
  readonly relaunch: boolean;
  /** The auto-updater can download and install a release. Packaged Electron only. */
  readonly updater: boolean;
  /** A native file or folder picker exists, so a route may be handed a path off this machine. */
  readonly nativeFilePicker: boolean;
  /**
   * A path typed or picked on this machine is meaningful to the host.
   *
   * Distinct from `nativeFilePicker`: webdev has no picker but IS the same machine as its host, so
   * a developer pasting a path still gets what they meant. On the hosted server neither is true —
   * the host's filesystem is the operator's, and a tenant naming a path on it is either confused
   * or probing.
   */
  readonly localPaths: boolean;
  /** "Start over" wipes this machine's whole data directory. Desktop and webdev only. */
  readonly startOver: boolean;
  /** A tenant can erase its own content without touching anybody else's. Hosted only. */
  readonly tenantReset: boolean;
  /** Native components may be downloaded and installed from here. Refused on a server (Phase 7). */
  readonly componentInstall: boolean;
};

/**
 * Resolve the capabilities of the process this runs in.
 *
 * Read per call rather than frozen at import, for the reason `isServerMode()` is: the suites and
 * `apps/web` both set environment after the module graph has loaded, and a set of capabilities
 * frozen at import time would answer for the mode the process started in.
 *
 * There is exactly one input, and that is the point. Every flag is derived from
 * `AGENTFORGE_SERVER` and nothing else, so a deployment cannot end up in a combination nobody has
 * thought about — no "hosted but with the updater on", no "desktop that refuses Start over". When
 * a flag needs a second input later (a hosted box without a bucket, say) it gets one here, in the
 * open, rather than in the handler that happens to care.
 *
 * **`nativeFilePicker` is false on webdev**, unlike `localPaths`. Webdev runs in a browser, which
 * has no picker to offer; it is the packaged shell that has one. This is the distinction the old
 * `isElectron()` checks were really making, written down.
 */
export function hostCapabilities(env: EnvLike = process.env): HostCapabilities {
  const hosted = isServerMode(env);
  return {
    sessions: hosted,
    singleOwner: !hosted,
    storageQuota: hosted,
    objectStorage: hosted,
    plans: hosted,
    // The host cannot see whether a shell is attached — only the renderer knows that, from its own
    // preload. What the host can say is whether a shell is *possible* here, which is what a hosted
    // deployment answers no to. The renderer ANDs this with its own bridge check.
    relaunch: !hosted,
    updater: !hosted,
    nativeFilePicker: !hosted,
    localPaths: !hosted,
    startOver: !hosted,
    tenantReset: hosted,
    componentInstall: !hosted,
  };
}

/**
 * Narrow an unknown payload to capabilities, treating anything missing or mistyped as `false`.
 *
 * The renderer parses what `GET /api/v1/ping` sent it, and an older host sends no `capabilities`
 * key at all. Every unknown reads as `false`, which hides a surface rather than offering one that
 * will be refused — the fail-closed direction, and the same reading Phase 7 gave `managed`.
 */
export function parseCapabilities(payload: unknown): HostCapabilities {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const flag = (key: keyof HostCapabilities): boolean => record[key] === true;
  return {
    sessions: flag("sessions"),
    singleOwner: flag("singleOwner"),
    storageQuota: flag("storageQuota"),
    objectStorage: flag("objectStorage"),
    plans: flag("plans"),
    relaunch: flag("relaunch"),
    updater: flag("updater"),
    nativeFilePicker: flag("nativeFilePicker"),
    localPaths: flag("localPaths"),
    startOver: flag("startOver"),
    tenantReset: flag("tenantReset"),
    componentInstall: flag("componentInstall"),
  };
}
