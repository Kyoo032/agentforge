/**
 * The operator path for a sign-in code.
 *
 * While the owner's team hands codes to users by hand, `pnpm portal:otp <email>` **issues** a
 * fresh code and prints it once to the operator's terminal. It is not a way to read a code out of
 * the database — only sha256 is stored, and that is not going to change — so this mints a new one,
 * stores its hash like any other, and writes an `otp.issued_manually` audit row so the handover
 * leaves the same trail a mailed code does.
 *
 * Three guards, because this hands a live credential to whoever runs the CLI:
 *   - `PORTAL_ALLOW_MANUAL_OTP=1` must be set explicitly;
 *   - `loadConfig` refuses that variable in production;
 *   - the address must already belong to a user, so the CLI cannot be used to probe for accounts
 *     in a tenant the operator does not administer (it answers the same way either way).
 */
import { randomOtpCode, normaliseEmail } from "./crypto";
import type { PortalConfig } from "./config";
import type { PortalStore } from "./store/types";

export interface ManualOtpInput {
  readonly email: string;
  readonly purpose?: "activate" | "portal_login";
  readonly ttlMs?: number;
}

export type ManualOtpResult =
  | {
      readonly ok: true;
      /** Printed once by the CLI and never written anywhere else. */
      readonly code: string;
      readonly email: string;
      readonly tenantId: string;
      readonly expiresAt: string;
    }
  | {
      readonly ok: false;
      readonly reason: "not_allowed" | "unknown_address" | "send_rate_limited";
      readonly retryAfter?: number;
    };

export class ManualOtpNotAllowedError extends Error {
  constructor() {
    super(
      "pnpm portal:otp needs PORTAL_ALLOW_MANUAL_OTP=1. It mints a live sign-in code and prints " +
        "it to this terminal, so it is opt-in, and it is refused outright in production.",
    );
    this.name = "ManualOtpNotAllowedError";
  }
}

export async function issueManualOtp(
  config: PortalConfig,
  store: PortalStore,
  input: ManualOtpInput,
): Promise<ManualOtpResult> {
  if (!config.allowManualOtp || config.production) {
    return { ok: false, reason: "not_allowed" };
  }

  const email = normaliseEmail(input.email);
  const tenantId = await store.resolve.byEmail(email);
  if (!tenantId) {
    // Unknown, or matching users in more than one tenant. Same answer either way — the resolver
    // is enumeration-resistant and this path does not undo that.
    return { ok: false, reason: "unknown_address" };
  }

  const code = randomOtpCode();
  return store.tx(tenantId, async (ops) => {
    const sent = await ops.loginOtps.send({
      tenantId,
      email,
      code,
      // `portal_login`, because the browser sign-in is what an operator hands a code out FOR.
      //
      // `login_otps.purpose` is part of what the store verifies, so a code minted for `activate`
      // — the device-code flow's purpose, and the only one that existed when this was written —
      // is refused by `/authorize/verify` as `no_code`. That refusal is deliberately the same one
      // an address with no live code gets, so an operator watches a code they just minted being
      // rejected and nothing anywhere says why. The device flow names its own purpose.
      purpose: input.purpose ?? "portal_login",
      ttlMs: input.ttlMs,
    });
    if (!sent.ok) {
      return { ok: false, reason: "send_rate_limited", retryAfter: sent.retryAfter } as const;
    }
    const user = await ops.users.findByEmail(tenantId, email);
    await ops.audit.append({
      tenantId,
      orgId: user?.orgId ?? null,
      actorKind: "support",
      action: "otp.issued_manually",
      targetKind: "login_otp",
      targetId: sent.otp.id,
      after: { purpose: sent.otp.purpose, expires_at: sent.otp.expiresAt },
    });

    return {
      ok: true,
      code,
      email,
      tenantId,
      expiresAt: sent.otp.expiresAt,
    } as const;
  });
}
