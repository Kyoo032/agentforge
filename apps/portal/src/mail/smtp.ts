/**
 * The SMTP transport.
 *
 * Real sending from day one, pointed at a sandbox (Mailpit, `apps/portal/compose.yml`) in
 * development and at a provider in production. There is deliberately no "write the code to a file"
 * and no "log the code" path anywhere in this package: the moment one exists, a production
 * incident is one env var away.
 *
 * Failure handling is the whole reason this file is not three lines. A send that fails must:
 *   - leave a log line that names the event, the recipient's domain and the transport's complaint;
 *   - never name the address, the subject, the body, or the code;
 *   - raise `MailDeliveryError`, so the caller answers the neutral "check your e-mail" page rather
 *     than telling the browser whether that address exists.
 */
import nodemailer from "nodemailer";
import type { SmtpConfig } from "../config";
import type { Logger } from "../log";
import { log as defaultLog } from "../log";
import { MailDeliveryError, type MailMessage, type Mailer, type SentMail, recipientDomain } from "./types";

export interface SmtpMailerOptions {
  readonly smtp: SmtpConfig;
  readonly logger?: Logger;
  /** Injected by the tests; defaults to a real nodemailer transport. */
  readonly transport?: MailTransport;
}

/** The slice of nodemailer's transporter this app uses. */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<{ messageId?: string; accepted?: unknown[] }>;
  close?(): void;
}

export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly requireTLS: boolean;
  readonly ignoreTLS: boolean;
  readonly auth?: { readonly user: string; readonly pass: string };
}

/**
 * The transport's options, as a value, so the one decision that matters here is testable without a
 * socket.
 *
 * It reads `loadConfig`'s answer and adds nothing. The previous version computed its own —
 * `ignoreTLS: !smtp.secure` — and `ignoreTLS` does not mean "the server might not offer TLS", it
 * means "do not attempt STARTTLS at all". So every provider on 587 received the sign-in code and
 * the SMTP AUTH user and password in cleartext, while the comment beside it claimed the opposite.
 * `requireTLS` is the flag that gets STARTTLS, and it also refuses to send when the server will
 * not upgrade, which is the behaviour a sign-in code needs.
 */
export function smtpTransportOptions(smtp: SmtpConfig): SmtpTransportOptions {
  return Object.freeze({
    host: smtp.host,
    port: smtp.port,
    // Implicit TLS (465). Mutually exclusive with STARTTLS by construction in `loadConfig`.
    secure: smtp.secure,
    requireTLS: smtp.requireTls,
    // Only ever true for a loopback sandbox: Mailpit speaks plain SMTP on 1025 and offers no
    // STARTTLS, so `requireTLS` there would refuse every development send.
    ignoreTLS: smtp.ignoreTls,
    ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
  });
}

export function createSmtpTransport(smtp: SmtpConfig): MailTransport {
  return nodemailer.createTransport({ ...smtpTransportOptions(smtp) }) as unknown as MailTransport;
}

export function createSmtpMailer(options: SmtpMailerOptions): Mailer {
  const logger = options.logger ?? defaultLog;
  const transport = options.transport ?? createSmtpTransport(options.smtp);

  return Object.freeze({
    async send(message: MailMessage): Promise<SentMail> {
      const domain = recipientDomain(message.to);
      try {
        const info = await transport.sendMail({
          from: options.smtp.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        });
        const accepted = Array.isArray(info.accepted) ? info.accepted.map(String) : [message.to];
        // `recipientDomain`, not the address; `messageId` is the transport's own handle and
        // carries nothing of the message.
        logger.info("mail_sent", { recipientDomain: domain, messageId: info.messageId ?? null });
        return Object.freeze({ messageId: String(info.messageId ?? ""), accepted: Object.freeze(accepted) });
      } catch (error) {
        logger.error("mail_send_failed", {
          recipientDomain: domain,
          smtpHost: options.smtp.host,
          smtpPort: options.smtp.port,
          reason: error instanceof Error ? error.message : "unknown",
        });
        throw new MailDeliveryError(domain, error);
      }
    },
    async close(): Promise<void> {
      transport.close?.();
    },
  });
}
