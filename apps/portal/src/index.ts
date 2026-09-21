/**
 * The package's public surface — for lane B (`src/routes`, `src/flows`, `src/views`, `src/otp`,
 * `src/security`, `src/jwt`) and for nothing else. The product never imports this package.
 */
export { loadConfig, PortalConfigError, type PortalConfig, type SmtpConfig } from "./config";
export { createLogger, log, redactSecrets, type Logger, type LogFields, type LogLevel } from "./log";
export {
  hashEquals,
  matchesHash,
  normaliseEmail,
  normaliseUserCode,
  randomOtpCode,
  randomToken,
  randomUserCode,
  sha256,
} from "./crypto";
export {
  createPortalServer,
  HEALTH_PATH,
  MAX_BODY_BYTES,
  type CreatePortalServerOptions,
  type PortalContext,
  type PortalRequest,
  type PortalResponse,
  type PortalRoute,
  type PortalServer,
} from "./server";
export { openStore, openPostgresStore } from "./store";
export * from "./store/types";
export { createMailer, createSmtpMailer, otpMessage, MailDeliveryError } from "./mail";
export type { Mailer, MailMessage, SentMail, MailLocale } from "./mail";
export { issueManualOtp, type ManualOtpResult } from "./manual-otp";
export { runSeed, formatSeedReport, type SeedResult } from "./seed/seed";
export { parseSeedArgs, SeedArgsError, SEED_USAGE, type SeedArgs } from "./seed/args";
