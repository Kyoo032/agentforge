/**
 * Sending a sign-in code, without telling the sender whether the address exists.
 *
 * `device-code-login.md`, GET /activate: "an address matching users in more than one tenant sends
 * nothing while still rendering the same neutral 'check your email' page". The same is true of an
 * address that matches no user, and of one whose tenant is not the client's. This function
 * therefore reports an *outcome* for the audit log and the caller renders the **same page for all
 * of them** -- the outcome never reaches the browser.
 *
 * Three things make that resistance real rather than nominal:
 *
 *   1. **Every path does the same work.** An unknown address still mints a code and still hashes
 *      it; only the INSERT and the SMTP hop are skipped.
 *   2. **Every path takes at least `minimumDurationMs`.** A send to Mailpit is tens of
 *      milliseconds and a rejected lookup is one; without a floor the difference is the oracle.
 *      It is a floor and not a constant-time implementation, which is the honest claim -- a
 *      slow mail provider is still slower than a refusal, and the answer to that is a queue, not
 *      a longer sleep.
 *   3. **A delivery failure is still neutral.** `MailDeliveryError` is caught, audited without
 *      the code, and reported as `delivery_failed`; the caller shows the same page.
 *
 * The 3-sends-per-15-minutes limit is not implemented here. It is counted from the `login_otps`
 * rows by `store.loginOtps.send` (`schema.md`), so there is one definition of it.
 */
import { randomOtpCode, normaliseEmail } from "../crypto";
import type { Logger } from "../log";
import { MailDeliveryError, type Mailer } from "../mail/types";
import { otpMessage } from "../mail/templates";
import { tenantProductName } from "./product-name";
import type { Clock, OtpPurpose, PortalStore } from "../store/types";
import type { PortalLocale } from "../views/i18n";

/** `login_otps.expires_at` defaults to `created_at + 10 minutes` (`0002_core_tables.sql`). */
export const OTP_TTL_MINUTES = 10;
const DEFAULT_MINIMUM_DURATION_MS = 150;

export interface OtpDeps {
  readonly store: PortalStore;
  readonly mailer: Mailer;
  readonly log: Logger;
  readonly clock: Clock;
  /** Injected by the tests so the floor does not make the suite slow. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly minimumDurationMs?: number;
}

export interface SendLoginOtpInput {
  readonly email: string;
  /**
   * The tenant the caller already knows the sign-in must belong to -- the OAuth client's tenant on
   * `/authorize`, or the `device_codes` row's on `/activate`. When it is set and the address
   * resolves elsewhere, nothing is sent: a Metranet build must not mail a JAST user.
   */
  readonly requiredTenantId?: string | null;
  readonly purpose?: OtpPurpose;
  readonly locale?: PortalLocale;
  readonly ip?: string | null;
  /**
   * Overrides the name in the subject line. Left unset by every caller today: the tenant's own
   * name is read from the store below (`otp/product-name.ts`), so the mail and the pages cannot
   * disagree about what this product is called.
   */
  readonly productName?: string;
}

export type SendLoginOtpOutcome =
  /** A code was minted, stored as sha256 and handed to the transport. */
  | "sent"
  /** Unknown address, an address in more than one tenant, or the wrong tenant for this client. */
  | "no_tenant"
  /** Three sends already inside the fifteen-minute window. */
  | "rate_limited"
  /** The row was written; SMTP refused it. Audited, never surfaced. */
  | "delivery_failed";

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendLoginOtp(
  deps: OtpDeps,
  input: SendLoginOtpInput,
): Promise<SendLoginOtpOutcome> {
  const startedAt = deps.clock.now().getTime();
  const floor = deps.minimumDurationMs ?? DEFAULT_MINIMUM_DURATION_MS;
  const sleep = deps.sleep ?? defaultSleep;

  const outcome = await attempt(deps, input);

  const elapsed = deps.clock.now().getTime() - startedAt;
  if (elapsed < floor) {
    await sleep(floor - elapsed);
  }
  return outcome;
}

async function attempt(deps: OtpDeps, input: SendLoginOtpInput): Promise<SendLoginOtpOutcome> {
  const email = normaliseEmail(input.email);
  // Minted before the lookup, so the work is the same on every path and the value is discarded
  // on the ones that send nothing.
  const code = randomOtpCode();

  const tenantId = await deps.store.resolve.byEmail(email);
  if (!tenantId) {
    return "no_tenant";
  }
  if (input.requiredTenantId && input.requiredTenantId !== tenantId) {
    return "no_tenant";
  }

  const purpose: OtpPurpose = input.purpose ?? "activate";
  const prepared = await deps.store.tx(tenantId, async (ops) => {
    const sent = await ops.loginOtps.send({ tenantId, email, code, purpose, createdIp: input.ip ?? null });
    if (!sent.ok) {
      const user = await ops.users.findByEmail(tenantId, email);
      await ops.audit.append({
        tenantId,
        orgId: user?.orgId ?? null,
        actorKind: "system",
        action: "otp.send_rate_limited",
        targetKind: "login_otp",
        reasonCode: "rate_limited",
        ip: input.ip ?? null,
      });
      return { ok: false as const, retryAfter: sent.retryAfter };
    }
    const user = await ops.users.findByEmail(tenantId, email);
    // Read in the transaction that is already open rather than in one of its own: this is the
    // name the subject line prints, and it must not cost the send a second round trip.
    const [tenant, config] = await Promise.all([
      ops.tenants.findById(tenantId),
      ops.tenantConfig.get(tenantId),
    ]);
    return {
      ok: true as const,
      otpId: sent.otp.id,
      orgId: user?.orgId ?? null,
      productName: tenantProductName(tenant, config?.branding),
    };
  });

  if (!prepared.ok) {
    return "rate_limited";
  }

  try {
    await deps.mailer.send(
      otpMessage({
        to: email,
        code,
        expiresInMinutes: OTP_TTL_MINUTES,
        locale: input.locale === "id" ? "id" : "en",
        productName: input.productName ?? prepared.productName ?? undefined,
      }),
    );
  } catch (error) {
    // The row stays. The user can ask for another code, the operator sees why this one never
    // arrived, and the browser is told nothing either way.
    deps.log.warn("otp_delivery_failed", {
      tenantId,
      reason: error instanceof MailDeliveryError ? error.message : "unknown",
    });
    await deps.store.tx(tenantId, (ops) =>
      ops.audit.append({
        tenantId,
        orgId: prepared.orgId,
        actorKind: "system",
        action: "otp.send_failed",
        targetKind: "login_otp",
        targetId: prepared.otpId,
        ip: input.ip ?? null,
      }),
    );
    return "delivery_failed";
  }

  await deps.store.tx(tenantId, (ops) =>
    ops.audit.append({
      tenantId,
      orgId: prepared.orgId,
      actorKind: "system",
      action: "otp.sent",
      targetKind: "login_otp",
      targetId: prepared.otpId,
      after: { purpose },
      ip: input.ip ?? null,
    }),
  );
  return "sent";
}
