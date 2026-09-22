/**
 * The device-code flow, built from `docs/internal/portal/device-code-login.md` verbatim.
 *
 *   POST /auth/device/code  -> user_code + device_code
 *   GET  /activate          -> the browser signs in and approves      (see ./browser.ts)
 *   POST /auth/device/approve
 *   POST /auth/device/token -> the app polls until it gets a session
 *
 * Three rules from that document that are easy to get wrong and are therefore spelled out here:
 *
 *   - **`platform` is mapped by the portal, not the client.** The client sends `process.platform`
 *     verbatim (`win32 | darwin | linux`) and anything outside the table is `400 invalid_request`
 *     rather than a guess, because an unmapped value must not silently become a wrong one.
 *   - **No `devices` row exists before approval.** Polling must not be able to create one, or
 *     polling could enumerate and consume seats.
 *   - **The browser may not restate what the device claimed.** `/activate` reads the platform and
 *     the label off the `device_codes` row, never off the query string.
 */
import type { DeviceCode, DevicePlatform, PortalOps } from "../store/types";
import { randomToken } from "../crypto";
import type { PortalRuntime } from "./context";
import { auditLoginDenied } from "./login";
import type { PortalReason } from "./reasons";
import { mintSession, type TokenResult } from "./token";

/** `devices_install_id_chk`: 8-128 characters. */
export const MIN_INSTALL_ID = 8;
export const MAX_INSTALL_ID = 128;
export const DEVICE_CODE_TTL_SECONDS = 600;
export const DEVICE_CODE_INTERVAL_SECONDS = 5;

/** The mapping table from the login doc. Anything else is refused, never guessed. */
const PLATFORM_MAP: Readonly<Record<string, DevicePlatform>> = Object.freeze({
  win32: "windows",
  darwin: "macos",
  linux: "linux",
});

export function mapPlatform(value: unknown): DevicePlatform | null {
  return typeof value === "string" ? (PLATFORM_MAP[value] ?? null) : null;
}

export interface DeviceCodeRequest {
  readonly installId: string | null;
  readonly tenantHint: string | null;
  readonly platform: string | null;
  readonly appVersion: string | null;
  readonly label: string | null;
  readonly ip?: string | null;
}

export interface DeviceCodeIssued {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly verification_uri_complete: string;
  readonly expires_in: number;
  readonly interval: number;
}

export type DeviceCodeResult =
  | { readonly ok: true; readonly body: DeviceCodeIssued }
  | { readonly ok: false; readonly reason: PortalReason };

export async function requestDeviceCode(
  runtime: PortalRuntime,
  request: DeviceCodeRequest,
): Promise<DeviceCodeResult> {
  const installId = request.installId;
  if (!installId || installId.length < MIN_INSTALL_ID || installId.length > MAX_INSTALL_ID) {
    return { ok: false, reason: "invalid_request" };
  }
  // Absent is fine (a generic build); present-and-unmapped is not.
  const platform = request.platform === null ? null : mapPlatform(request.platform);
  if (request.platform !== null && platform === null) {
    return { ok: false, reason: "invalid_request" };
  }

  let tenantId: string | null = null;
  if (request.tenantHint) {
    tenantId = await runtime.store.resolve.bySlug(request.tenantHint);
    if (!tenantId) {
      return { ok: false, reason: "tenant_inactive" };
    }
    const active = await runtime.store.tx(tenantId, async (ops) => {
      const tenant = await ops.tenants.findById(tenantId as string);
      return tenant?.status === "active";
    });
    if (!active) {
      return { ok: false, reason: "tenant_inactive" };
    }
  }

  const rawDeviceCode = randomToken();
  const created = await runtime.store.tx(tenantId, async (ops) => {
    const code = await ops.deviceCodes.create({
      rawDeviceCode,
      installId,
      platform,
      tenantId,
      clientName: request.label,
      clientVersion: request.appVersion,
      ttlMs: DEVICE_CODE_TTL_SECONDS * 1000,
      intervalSeconds: DEVICE_CODE_INTERVAL_SECONDS,
      createdIp: request.ip ?? null,
    });
    // audit_log.tenant_id is NOT NULL (0003), so a code minted by a generic build with no
    // tenant_hint has nowhere to write `device_code.requested`. Branded builds -- every shipped
    // installer -- always carry a hint and always audit.
    if (tenantId) {
      await ops.audit.append({
        tenantId,
        actorKind: "system",
        action: "device_code.requested",
        targetKind: "device_code",
        targetId: code.id,
        after: { platform, client_version: request.appVersion },
        ip: request.ip ?? null,
      });
    }
    return code;
  });

  const activate = `${runtime.issuer}/activate`;
  return {
    ok: true,
    body: Object.freeze({
      device_code: rawDeviceCode,
      user_code: created.userCode,
      verification_uri: activate,
      verification_uri_complete: `${activate}?code=${encodeURIComponent(created.userCode)}`,
      expires_in: DEVICE_CODE_TTL_SECONDS,
      interval: created.intervalSeconds,
    }),
  };
}

export type ApproveDecision = "approve" | "deny";

export interface ApproveInput {
  readonly userCode: string;
  readonly decision: ApproveDecision;
  readonly tenantId: string;
  readonly userId: string;
  readonly ip?: string | null;
}

export type ApproveResult =
  | { readonly ok: true; readonly status: "approved" | "denied"; readonly deviceLabel: string | null }
  | { readonly ok: false; readonly reason: PortalReason };

/**
 * One transaction, in the order the doc's numbered list gives: load the row, resolve and pin the
 * tenant, deny early if asked, upsert `devices` on `(user_id, install_id)`, run the login gate,
 * then a single UPDATE -- because `device_codes_approved_chk` wants tenant, user and org together.
 */
export async function decideDeviceCode(
  runtime: PortalRuntime,
  input: ApproveInput,
): Promise<ApproveResult> {
  return runtime.store.tx(input.tenantId, async (ops) => {
    const pending = await ops.deviceCodes.findByUserCode(input.userCode);
    if (pending?.status !== "pending" || new Date(pending.expiresAt) <= runtime.clock.now()) {
      return { ok: false as const, reason: "device_code_expired" as const };
    }
    // A code minted for one partner cannot be approved into another.
    if (pending.tenantId !== null && pending.tenantId !== input.tenantId) {
      return { ok: false as const, reason: "tenant_inactive" as const };
    }

    if (input.decision === "deny") {
      const denied = await ops.deviceCodes.deny(input.userCode);
      if (!denied.ok) {
        return { ok: false as const, reason: "device_code_expired" as const };
      }
      await ops.audit.append({
        tenantId: input.tenantId,
        actorKind: "user",
        actorUserId: input.userId,
        action: "device_code.denied",
        targetKind: "device_code",
        targetId: denied.code.id,
        ip: input.ip ?? null,
      });
      return { ok: true as const, status: "denied" as const, deviceLabel: denied.code.clientName };
    }

    const user = await ops.users.findById(input.userId);
    if (!user || !pending.installId) {
      return { ok: false as const, reason: "invalid_request" as const };
    }

    const upserted = await ops.devices.upsert({
      tenantId: input.tenantId,
      orgId: user.orgId,
      userId: user.id,
      installId: pending.installId,
      platform: pending.platform ?? "windows",
      label: pending.clientName,
      appVersion: pending.clientVersion,
    });
    if (!upserted.ok) {
      await auditLoginDenied(ops, {
        tenantId: input.tenantId,
        orgId: user.orgId,
        userId: user.id,
        reason: "device_revoked",
        ip: input.ip ?? null,
      });
      return { ok: false as const, reason: "device_revoked" as const };
    }

    const reason = await ops.loginPrecheck({
      userId: user.id,
      deviceId: upserted.device.id,
      sessionId: null,
    });
    if (reason !== "ok") {
      await ops.deviceCodes.deny(input.userCode);
      await auditLoginDenied(ops, {
        tenantId: input.tenantId,
        orgId: user.orgId,
        userId: user.id,
        reason,
        ip: input.ip ?? null,
      });
      return { ok: false as const, reason: reason as PortalReason };
    }

    const approved = await ops.deviceCodes.approve({
      userCode: input.userCode,
      tenantId: input.tenantId,
      orgId: user.orgId,
      userId: user.id,
      deviceId: upserted.device.id,
      approvedIp: input.ip ?? null,
    });
    if (!approved.ok) {
      return { ok: false as const, reason: "device_code_expired" as const };
    }

    await ops.audit.append({
      tenantId: input.tenantId,
      orgId: user.orgId,
      actorKind: "user",
      actorUserId: user.id,
      action: "device_code.approved",
      targetKind: "device_code",
      targetId: approved.code.id,
      after: { device_id: upserted.device.id },
      ip: input.ip ?? null,
    });
    return {
      ok: true as const,
      status: "approved" as const,
      deviceLabel: upserted.device.label,
    };
  });
}

export interface PollInput {
  readonly deviceCode: string;
  readonly installId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export type PollResult =
  | TokenResult
  | { readonly ok: false; readonly reason: PortalReason; readonly retryAfter: number };

/** Thrown to roll the session back when a racing poll redeemed the code first. */
class LostRedeemRace extends Error {}

export async function pollDeviceToken(runtime: PortalRuntime, input: PollInput): Promise<PollResult> {
  const polled = await runtime.store.pollDeviceCode(input.deviceCode, input.installId);

  if (polled.reason === "slow_down") {
    return { ok: false, reason: "slow_down", retryAfter: polled.retryAfter };
  }
  if (polled.reason === "authorization_pending") {
    return { ok: false, reason: "authorization_pending", retryAfter: polled.intervalSeconds };
  }
  if (polled.reason !== "ok") {
    await auditPollFailure(runtime, input, polled.reason);
    return { ok: false, reason: polled.reason };
  }

  const code: DeviceCode = polled.code;
  if (!code.tenantId || !code.userId || !code.orgId || !code.deviceId) {
    // device_codes_approved_chk makes this unreachable for an approved row; treated as a refusal
    // rather than a 500 so a corrupt row cannot take the endpoint down.
    return { ok: false, reason: "invalid_grant" };
  }

  try {
    return await runtime.store.tx(code.tenantId, async (ops) => {
      // State can change in the seconds between the browser approving and the app polling.
      const reason = await ops.loginPrecheck({
        userId: code.userId as string,
        deviceId: code.deviceId as string,
        sessionId: null,
      });
      if (reason !== "ok") {
        await auditLoginDenied(ops, {
          tenantId: code.tenantId as string,
          orgId: code.orgId,
          userId: code.userId,
          reason,
          ip: input.ip ?? null,
        });
        return { ok: false as const, reason: reason as PortalReason };
      }

      const minted = await mintSession(runtime, ops, {
        tenantId: code.tenantId as string,
        orgId: code.orgId as string,
        userId: code.userId as string,
        deviceId: code.deviceId as string,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });
      if (!minted.ok) {
        return minted;
      }

      // Single use, in the same transaction that issued the session. A racing poll that got here
      // first leaves this UPDATE matching nothing, and the throw rolls our session back rather
      // than leaving an orphan behind.
      const redeemed = await ops.deviceCodes.redeem({
        rawDeviceCode: input.deviceCode,
        sessionId: minted.body.session_id,
      });
      if (!redeemed) {
        throw new LostRedeemRace();
      }
      return minted;
    });
  } catch (error) {
    if (error instanceof LostRedeemRace) {
      return { ok: false, reason: "invalid_grant" };
    }
    throw error;
  }
}

/**
 * `device_code.replayed` and the other terminal refusals, written only when a tenant can be
 * resolved. An unknown `device_code` resolves to nothing, which is exactly the case where there
 * must be no row and no distinguishable answer.
 */
async function auditPollFailure(
  runtime: PortalRuntime,
  input: PollInput,
  reason: PortalReason,
): Promise<void> {
  const tenantId = await runtime.store.resolve.byDeviceCode(input.deviceCode);
  if (!tenantId) {
    return;
  }
  await runtime.store.tx(tenantId, (ops: PortalOps) =>
    ops.audit.append({
      tenantId,
      actorKind: "system",
      action: reason === "invalid_grant" ? "device_code.replayed" : "device_code.poll_denied",
      targetKind: "device_code",
      reasonCode: reason,
      ip: input.ip ?? null,
    }),
  );
}
