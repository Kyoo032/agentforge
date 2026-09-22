/** What the portal needs from a mail transport, and nothing more. */

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface SentMail {
  readonly messageId: string;
  readonly accepted: readonly string[];
}

export interface Mailer {
  send(message: MailMessage): Promise<SentMail>;
  close(): Promise<void>;
}

/**
 * Thrown when delivery failed. The message deliberately carries the transport's complaint and the
 * recipient's *domain* only — never the address, never the body, and never the code that was in
 * it. The caller answers the user with the neutral "check your e-mail" page either way; this error
 * exists for the operator's log.
 */
export class MailDeliveryError extends Error {
  readonly recipientDomain: string;

  constructor(recipientDomain: string, cause?: unknown) {
    super(`mail delivery to a ${recipientDomain} address failed`);
    this.name = "MailDeliveryError";
    this.recipientDomain = recipientDomain;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * `someone@example.com` -> `example.com`, and `Kyo <someone@example.com>` too. Used for logs, so
 * it never carries the local part and never carries the display name either.
 */
export function recipientDomain(address: string): string {
  const at = address.lastIndexOf("@");
  if (at === -1) {
    return "unknown";
  }
  const domain = address
    .slice(at + 1)
    .replace(/[>\s].*$/, "")
    .toLowerCase();
  return domain === "" ? "unknown" : domain;
}
