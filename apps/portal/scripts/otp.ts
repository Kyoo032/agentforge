#!/usr/bin/env tsx
/**
 * `pnpm portal:otp <email>` — mint a sign-in code for an operator to read out, once.
 *
 * Refused unless `PORTAL_ALLOW_MANUAL_OTP=1`, and refused outright in production. Only the hash
 * is stored, so this issues a fresh code rather than reading one back; the handover is recorded
 * as `otp.issued_manually` in the audit log.
 */
import { loadConfig, PortalConfigError } from "../src/config";
import { issueManualOtp } from "../src/manual-otp";
import { openStore } from "../src/store";

const USAGE = `Usage:
  PORTAL_ALLOW_MANUAL_OTP=1 pnpm portal:otp -- <email> [--activate]

Mints a live 6-digit sign-in code for that address and prints it once. The address must already
belong to exactly one user. Refused in production.

By default the code is for the BROWSER sign-in (/authorize), which is what the hosted app uses.
--activate mints one for the device-code flow (/activate) instead. A code minted for one is
refused by the other as no_code — login_otps rows carry the purpose and the verify matches on it.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args.find((token) => !token.startsWith("-"));
  const purpose = args.includes("--activate") ? "activate" : "portal_login";
  if (!email) {
    console.error(USAGE);
    process.exit(2);
  }

  const config = loadConfig();
  if (!config.allowManualOtp) {
    console.error(
      "Refused: PORTAL_ALLOW_MANUAL_OTP=1 is not set.\n\n" +
        "This command mints a live sign-in code and prints it to this terminal, so it is opt-in.\n" +
        "In development the codes are also delivered to Mailpit at http://127.0.0.1:8025.",
    );
    process.exit(3);
  }

  const store = openStore(config);
  try {
    const result = await issueManualOtp(config, store, { email, purpose });
    if (!result.ok) {
      if (result.reason === "send_rate_limited") {
        console.error(
          `Refused: three codes have already gone to that address in the last 15 minutes. ` +
            `Try again in ${result.retryAfter ?? 0}s.`,
        );
        process.exit(4);
      }
      // Unknown, or an address that matches users in more than one tenant. Same answer for both.
      console.error("Refused: that address does not resolve to exactly one user.");
      process.exit(5);
    }

    process.stdout.write(
      [
        `code       ${result.code}`,
        `address    ${result.email}`,
        `expires    ${result.expiresAt}`,
        // Named, because the wrong purpose is refused as `no_code` — the same answer an address
        // with no live code gets, which tells an operator nothing about what went wrong.
        `for        ${purpose === "activate" ? "the device-code flow (/activate)" : "the browser sign-in (/authorize)"}`,
        "",
        "Read it out once. It is single-use, and only its sha256 is stored — this is the only",
        "time it can be displayed.",
        "",
      ].join("\n"),
    );
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof PortalConfigError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
