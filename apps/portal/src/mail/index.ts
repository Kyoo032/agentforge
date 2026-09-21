import type { PortalConfig } from "../config";
import type { Logger } from "../log";
import { createSmtpMailer } from "./smtp";
import type { Mailer } from "./types";

export * from "./types";
export * from "./templates";
export { createSmtpMailer, createSmtpTransport, type MailTransport } from "./smtp";

/** The portal's mailer: SMTP, always. The sandbox is chosen by `PORTAL_SMTP_HOST`, not by code. */
export function createMailer(config: PortalConfig, logger?: Logger): Mailer {
  return createSmtpMailer({ smtp: config.smtp, logger });
}
