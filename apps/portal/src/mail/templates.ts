/**
 * The OTP e-mail, in both locales.
 *
 * `AGENTS.md`: "Every user-facing string exists in both `en` and `id` catalogs." The portal's copy
 * lives here rather than in a renderer catalog, for the same reason host copy stays host-side —
 * the portal has no renderer, and this text is sent from the server.
 *
 * The copy says three things and no more: the code, how long it lasts, and what to do if it was
 * not you. No links (a sign-in mail with a link is a phishing template), no branding block to
 * template-inject into, no tracking pixel.
 */
import { translator } from "../views/i18n";
import type { MailMessage } from "./types";

export type MailLocale = "en" | "id";

export interface OtpMessageInput {
  readonly to: string;
  readonly code: string;
  readonly expiresInMinutes: number;
  readonly locale?: MailLocale;
  /**
   * The tenant's product name, e.g. "AIHub Metranet", from `otp/product-name.ts`. Unset when the
   * tenant has not chosen one, and then the portal's own copy applies -- see below.
   */
  readonly productName?: string;
}

/**
 * The name the PAGES print, read from the same catalog they read it from
 * (`locales/<locale>/portal.json`, key `product`).
 *
 * This used to be a constant here, and it named the product one thing while every page of the same
 * sign-in named it another. One catalog entry, two consumers -- the alternative is two copies that
 * drift, and this file is the proof that they do.
 */
function defaultProductName(locale: MailLocale): string {
  return translator(locale)("product");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COPY = {
  en: (product: string, code: string, minutes: number) => ({
    subject: `${product} sign-in code: ${code}`,
    lines: [
      `Your ${product} sign-in code is ${code}.`,
      ``,
      `It expires in ${minutes} minutes and can be used once.`,
      `If you did not start a sign-in, ignore this message — nobody can use the code without it.`,
    ],
  }),
  id: (product: string, code: string, minutes: number) => ({
    subject: `Kode masuk ${product}: ${code}`,
    lines: [
      `Kode masuk ${product} Anda adalah ${code}.`,
      ``,
      `Kode ini kedaluwarsa dalam ${minutes} menit dan hanya dapat dipakai sekali.`,
      `Jika Anda tidak memulai proses masuk, abaikan pesan ini — kode tidak dapat dipakai tanpa Anda.`,
    ],
  }),
} as const;

export function otpMessage(input: OtpMessageInput): MailMessage {
  const locale: MailLocale = input.locale === "id" ? "id" : "en";
  const product = input.productName?.trim() || defaultProductName(locale);
  const { subject, lines } = COPY[locale](product, input.code, input.expiresInMinutes);

  const html = [
    "<html><body style=\"font-family:system-ui,sans-serif;font-size:15px;line-height:1.5\">",
    ...lines.map((line) =>
      line === "" ? "<p></p>" : `<p>${escapeHtml(line).replace(escapeHtml(input.code), `<strong>${escapeHtml(input.code)}</strong>`)}</p>`,
    ),
    "</body></html>",
  ].join("");

  return Object.freeze({ to: input.to, subject, text: lines.join("\n"), html });
}
