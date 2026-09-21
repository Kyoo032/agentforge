/**
 * The login gate, and the one `devices` row the browser flow needs.
 *
 * `sessions.device_id` is NOT NULL and `login_precheck` refuses a user with no live device row
 * (`device_revoked`), so a browser sign-in needs a device exactly as a desktop one does. The
 * browser has no `install_id` to send, so the portal derives one: **one device row per
 * `(user, oauth client)`**, `platform = 'web'`.
 *
 * That choice, stated plainly, because it is a real trade:
 *
 *   - What it buys: `devices.platform` already reserves `web`, the row is stable across browsers
 *     and restarts, and it is derivable at `/auth/token` time from the authorization code alone --
 *     which matters because the host exchanges the code server-side and holds nothing of the
 *     browser.
 *   - What it costs: two browsers of the same user share one device row, so an admin cannot
 *     revoke one browser without revoking both. Per-browser granularity needs a `device_id` column
 *     on `auth_codes` -- a column this lane can add but cannot write, because the store contract
 *     belongs to another lane. It is recorded as a follow-up rather than half-built.
 *
 * Individual sessions stay individually revocable either way: `sessions` is per sign-in, and
 * `POST /auth/logout` revokes one or all of them.
 */
import type { DenialReason, Device, PortalOps, User } from "../store/types";

/** `devices_install_id_chk` wants 8-128 characters; the prefix guarantees the floor. */
export function webInstallId(clientId: string): string {
  return `web-client-${clientId}`;
}

export const WEB_DEVICE_LABEL = "Web browser";

export interface BrowserDeviceInput {
  readonly tenantId: string;
  readonly user: User;
  readonly installId: string;
}

export type LoginGateResult =
  | { readonly ok: true; readonly device: Device }
  | { readonly ok: false; readonly reason: DenialReason; readonly device: Device | null };

/**
 * Upsert the device, then run the gate the doc specifies at approve time: tenant active, org
 * active and not past due, user active, device not revoked, and a seat available.
 *
 * `sessionId` is null here on purpose. That is the branch of `login_precheck` that takes the org
 * advisory lock and counts the seat, which is what makes "seat cap reached" visible in the browser
 * -- where an admin can act -- rather than only at token time.
 */
export async function runBrowserLoginGate(
  ops: PortalOps,
  input: BrowserDeviceInput,
): Promise<LoginGateResult> {
  const upserted = await ops.devices.upsert({
    tenantId: input.tenantId,
    orgId: input.user.orgId,
    userId: input.user.id,
    installId: input.installId,
    platform: "web",
    label: WEB_DEVICE_LABEL,
  });
  if (!upserted.ok) {
    return { ok: false, reason: "device_revoked", device: upserted.device };
  }

  const reason = await ops.loginPrecheck({
    userId: input.user.id,
    deviceId: upserted.device.id,
    sessionId: null,
  });
  if (reason !== "ok") {
    return { ok: false, reason, device: upserted.device };
  }
  return { ok: true, device: upserted.device };
}

/** `login.denied` with the reason, which is what an admin reads when a user says "it says no". */
export async function auditLoginDenied(
  ops: PortalOps,
  input: {
    readonly tenantId: string;
    readonly orgId: string | null;
    readonly userId: string | null;
    readonly reason: string;
    readonly ip?: string | null;
    readonly targetId?: string | null;
  },
): Promise<void> {
  await ops.audit.append({
    tenantId: input.tenantId,
    orgId: input.orgId,
    actorKind: "user",
    actorUserId: input.userId,
    action: "login.denied",
    targetKind: "user",
    targetId: input.targetId ?? input.userId,
    reasonCode: input.reason,
    ip: input.ip ?? null,
  });
}
