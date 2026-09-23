/**
 * Checking a code, and the audit trail the login doc asks for (`otp.verified`, `otp.failed`).
 *
 * The attempt counting, the 10-minute window and the single-use consumption all live in
 * `store.loginOtps.verify` -- `login_otps.attempts` is capped at 5 by a CHECK and `consumed_at` is
 * set in the same transaction, so a sixth attempt and a replayed code are both refused by the
 * database rather than by a counter this file keeps.
 *
 * What is added here is the same tenant discipline the send path has: an address that resolves to
 * no tenant, to more than one, or to a tenant other than the one the caller requires, is refused
 * with `no_code` -- the answer a real address with no live code gets -- so verifying is not an
 * enumeration oracle either.
 *
 * The daily total (20 guesses per address per 24 h) is the store's too. When it refuses, the audit
 * row is `otp.locked` rather than `otp.failed`: nothing was compared, and an operator reading the
 * log needs to see that the address is locked, not one more wrong guess.
 */
import { normaliseEmail } from "../crypto";
import type { Logger } from "../log";
import type { Clock, OtpPurpose, PortalStore, User } from "../store/types";

export interface VerifyDeps {
  readonly store: PortalStore;
  readonly log: Logger;
  readonly clock: Clock;
}

export interface VerifyLoginOtpInput {
  readonly email: string;
  readonly code: string;
  readonly requiredTenantId?: string | null;
  readonly purpose?: OtpPurpose;
  readonly ip?: string | null;
}

export type VerifyLoginOtpOutcome =
  | { readonly ok: true; readonly tenantId: string; readonly user: User }
  | {
      readonly ok: false;
      readonly reason: "no_code" | "expired" | "too_many_attempts" | "invalid_code" | "locked";
      readonly attemptsRemaining: number;
    };

export async function verifyLoginOtp(
  deps: VerifyDeps,
  input: VerifyLoginOtpInput,
): Promise<VerifyLoginOtpOutcome> {
  const email = normaliseEmail(input.email);
  const tenantId = await deps.store.resolve.byEmail(email);
  if (!tenantId || (input.requiredTenantId && input.requiredTenantId !== tenantId)) {
    return { ok: false, reason: "no_code", attemptsRemaining: 0 };
  }

  const purpose: OtpPurpose = input.purpose ?? "activate";
  return deps.store.tx(tenantId, async (ops) => {
    const result = await ops.loginOtps.verify({ tenantId, email, code: input.code, purpose });
    const user = await ops.users.findByEmail(tenantId, email);

    if (!result.ok) {
      await ops.audit.append({
        tenantId,
        orgId: user?.orgId ?? null,
        actorKind: "user",
        actorUserId: user?.id ?? null,
        action: result.reason === "locked" ? "otp.locked" : "otp.failed",
        targetKind: "login_otp",
        reasonCode: result.reason,
        ip: input.ip ?? null,
      });
      return result;
    }

    // A consumed code with no user behind it cannot happen (login_otps rows are only minted for
    // resolved addresses), but a deleted user between send and verify would land here.
    if (!user) {
      return { ok: false as const, reason: "no_code" as const, attemptsRemaining: 0 };
    }

    await ops.audit.append({
      tenantId,
      orgId: user.orgId,
      actorKind: "user",
      actorUserId: user.id,
      action: "otp.verified",
      targetKind: "login_otp",
      targetId: result.otp.id,
      ip: input.ip ?? null,
    });
    return { ok: true as const, tenantId, user };
  });
}
