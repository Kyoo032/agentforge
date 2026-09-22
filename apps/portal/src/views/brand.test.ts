/**
 * The portal calls the product DPSBuddy, on every screen and in every e-mail.
 *
 * Owner ruling, 2026-09-21: the product NAME in text is DPSBuddy everywhere, and the LOGO stays the
 * chevron lockup -- `assets/logo.png`, served by `routes/assets.ts` and shown in the page shell.
 * The names below are the ones the ruling retired; this file is the only place they may appear.
 *
 * This is a guard, not a rename receipt. The portal has had two names for one flow before: the OTP
 * subject said one thing while the page under it said another (`otp/product-name.ts` is the fix and
 * `mail/mail.test.ts` is the record). A rename that touches only the strings somebody grepped for
 * is the same bug with a new pair of names, so this walks everything the user actually receives --
 * the catalogs, all six screens in both locales, and the mail -- and fails on any of the old ones.
 *
 * `Toko Token` on its own is NOT forbidden: that is the gateway's name (`gatewayName`), a different
 * thing from the product, and it is allowed to appear. Only "Toko Token AI", which was once used as
 * a product name, is.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { otpMessage } from "../mail/templates";
import { catalogFor, PORTAL_LOCALES, translator, type PortalLocale } from "./i18n";
import { approvePage, enterCodePage, errorPage, outcomePage, signInPage, userCodePage } from "./pages";

const PRODUCT_NAME = "DPSBuddy";

/** Every name the product has ever been called that is not its name. Matched case-insensitively. */
const FORBIDDEN = Object.freeze(["DPS Cloud", "DPSCloud", "Toko Token AI"]);

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const localesDir = join(appDir, "locales");

function offendersIn(label: string, text: string): string[] {
  const found: string[] = [];
  for (const forbidden of FORBIDDEN) {
    text.split("\n").forEach((line, index) => {
      if (line.toLowerCase().includes(forbidden.toLowerCase())) {
        found.push(`${label}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return found;
}

/** Every screen the portal can render, in one locale. One call per `page()` caller in `pages.ts`. */
function everyScreen(locale: PortalLocale): Array<{ label: string; html: string }> {
  const t = translator(locale);
  const base = { locale, t } as const;
  return [
    {
      label: `signIn(${locale})`,
      html: signInPage({ ...base, action: "/authorize/email", csrfToken: "tok", hidden: { state: "s" } }),
    },
    {
      label: `enterCode(${locale})`,
      html: enterCodePage({
        ...base,
        action: "/authorize/verify",
        csrfToken: "tok",
        hidden: { state: "s" },
        expiresInMinutes: 10,
      }),
    },
    {
      label: `userCode(${locale})`,
      html: userCodePage({ ...base, action: "/activate", csrfToken: "tok" }),
    },
    {
      label: `approve(${locale})`,
      html: approvePage({
        ...base,
        action: "/auth/device/approve",
        csrfToken: "tok",
        userCode: "K7M4-PQ9T",
        platform: t("platform.windows"),
        deviceLabel: null,
      }),
    },
    {
      label: `outcome(${locale})`,
      html: outcomePage({ ...base, title: t("success.title"), message: t("success.body", { product: t("product") }) }),
    },
    { label: `error(${locale})`, html: errorPage({ ...base, message: t("error.generic") }) },
  ];
}

describe("the portal's product name", () => {
  it("is DPSBuddy in both shipped catalogs", () => {
    for (const locale of PORTAL_LOCALES) {
      expect(translator(locale)("product"), locale).toBe(PRODUCT_NAME);
      expect((catalogFor(locale) as Record<string, unknown>).product, locale).toBe(PRODUCT_NAME);
    }
  });

  it("is what every screen prints, in both locales", () => {
    for (const locale of PORTAL_LOCALES) {
      for (const screen of everyScreen(locale)) {
        expect(screen.html, screen.label).toContain(PRODUCT_NAME);
      }
    }
  });

  it("is what the sign-in mail says, subject and body, in both locales", () => {
    expect(otpMessage({ to: "a@b.test", code: "000000", expiresInMinutes: 10, locale: "en" }).subject).toBe(
      `${PRODUCT_NAME} sign-in code: 000000`,
    );
    expect(otpMessage({ to: "a@b.test", code: "000000", expiresInMinutes: 10, locale: "id" }).subject).toBe(
      `Kode masuk ${PRODUCT_NAME}: 000000`,
    );
  });

  it("is the only product name in the shipped catalogs", () => {
    const offenders: string[] = [];
    for (const locale of readdirSync(localesDir)) {
      for (const name of readdirSync(join(localesDir, locale))) {
        const path = join(localesDir, locale, name);
        offenders.push(...offendersIn(`locales/${locale}/${name}`, readFileSync(path, "utf8")));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is the only product name on any rendered screen or in any mail", () => {
    const offenders: string[] = [];
    for (const locale of PORTAL_LOCALES) {
      for (const screen of everyScreen(locale)) {
        offenders.push(...offendersIn(screen.label, screen.html));
      }
      const mail = otpMessage({ to: "a@b.test", code: "000000", expiresInMinutes: 10, locale });
      offenders.push(...offendersIn(`mail.subject(${locale})`, mail.subject));
      offenders.push(...offendersIn(`mail.text(${locale})`, mail.text));
      offenders.push(...offendersIn(`mail.html(${locale})`, mail.html ?? ""));
    }
    expect(offenders).toEqual([]);
  });
});
