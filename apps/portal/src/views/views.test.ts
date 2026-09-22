import { describe, expect, it } from "vitest";
import { escapeHtml, html, raw } from "./escape";
import {
  catalogFor,
  copyPair,
  negotiateLocale,
  parsePortalLocale,
  PORTAL_LOCALES,
  translator,
} from "./i18n";
import { approvePage, enterCodePage, errorPage, signInPage, userCodePage } from "./pages";

const t = translator("en");
const base = { locale: "en" as const, t };

/**
 * Payloads a value on these screens could carry, from the query or a form post. Each contains at
 * least one of `< > " '`, so "the payload does not appear verbatim" is exactly the claim that it
 * was escaped -- and `<script`, `<img` and `<svg` being absent is the claim that no new element
 * was created.
 */
const INJECTIONS = [
  '"><script>alert(1)</script>',
  "</textarea><img src=x onerror=alert(1)>",
  "' onmouseover='alert(1)",
  "</style><svg/onload=alert(1)>",
];

function expectNoInjectedMarkup(page: string, payload: string): void {
  expect(page).not.toContain(payload);
  for (const opening of ["<script", "<svg", "<textarea"]) {
    expect(page).not.toContain(opening);
  }
  // `<img` is counted rather than forbidden: the shell carries exactly one, the brand mark, and it
  // is written by `layout.ts` with a fixed src. So "no injected image" is "still exactly one", and
  // an `<img` a payload smuggled in would make it two.
  expect(page.split("<img")).toHaveLength(2);
  expect(page).toContain('<img src="/assets/logo.png"');
  // The shell's own <style> block, and no second one closed early by a payload.
  expect(page.split("</style>")).toHaveLength(2);
}

describe("escaping", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  it("escapes every interpolation of the html tag", () => {
    expect(html`<p>${"<b>hi</b>"}</p>`.value).toBe("<p>&lt;b&gt;hi&lt;/b&gt;</p>");
  });

  it("leaves markup alone only when it was wrapped in raw()", () => {
    expect(html`<p>${raw("<b>hi</b>")}</p>`.value).toBe("<p><b>hi</b></p>");
  });

  it("renders an array of fragments and drops nullish values", () => {
    expect(html`${[html`<i>a</i>`, html`<i>b</i>`]}${null}${undefined}${false}`.value).toBe(
      "<i>a</i><i>b</i>",
    );
  });
});

describe("locale negotiation", () => {
  it("prefers ?lang= over the browser", () => {
    expect(negotiateLocale(new URLSearchParams("lang=id"), "en-GB,en;q=0.9")).toBe("id");
  });

  it("reads Accept-Language in q order", () => {
    expect(negotiateLocale(new URLSearchParams(), "fr;q=0.9,id-ID;q=0.8")).toBe("id");
    expect(negotiateLocale(new URLSearchParams(), "id;q=0.2,en;q=0.9")).toBe("en");
  });

  it("falls back to English for an unknown or missing value", () => {
    expect(negotiateLocale(new URLSearchParams("lang=fr"), undefined)).toBe("en");
    expect(negotiateLocale(new URLSearchParams(), "fr,de")).toBe("en");
    expect(negotiateLocale(new URLSearchParams(), undefined)).toBe("en");
    expect(parsePortalLocale("ID")).toBe("id");
    expect(parsePortalLocale("klingon")).toBeNull();
  });
});

describe("copy", () => {
  it("has the same leaf keys in en and id", () => {
    const leaves = (node: unknown, prefix = ""): string[] =>
      typeof node === "object" && node !== null
        ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
            leaves(value, prefix ? `${prefix}.${key}` : key),
          )
        : [prefix];

    const [en, id] = PORTAL_LOCALES.map((locale) => leaves(catalogFor(locale)).sort());
    expect(id).toEqual(en);
  });

  it("carries the reason-code copy device-code-login.md freezes, in both locales", () => {
    expect(copyPair("reason.seat_cap_reached")).toEqual({
      en: "No seats left in your organisation.",
      id: "Tidak ada kursi tersisa di organisasi Anda.",
    });
    expect(copyPair("reason.org_past_due").id).toBe("Pembayaran organisasi Anda tertunggak.");
  });

  it("fills the slots in a template", () => {
    expect(translator("id")("sent.body", { minutes: 10 })).toContain("10 menit");
    expect(translator("en")("code.invalid", { attempts: 3 })).toBe(
      "That code is not right. 3 attempts left.",
    );
  });

  it("returns the key rather than throwing when it does not exist", () => {
    expect(t("nope.not.here")).toBe("nope.not.here");
  });

  it("names the product DPSBuddy in both locales", () => {
    expect(copyPair("product")).toEqual({ en: "DPSBuddy", id: "DPSBuddy" });
  });
});

describe("pages", () => {
  it("renders the sign-in form with the hidden authorize parameters and a CSRF field", () => {
    const page = signInPage({
      ...base,
      action: "/authorize/email",
      csrfToken: "tok-1",
      hidden: { client_id: "agentforge-web", redirect_uri: "https://localhost:3443/auth/callback", state: "s1" },
    });

    expect(page).toContain('<form method="post" action="/authorize/email">');
    expect(page).toContain('name="csrf_token" value="tok-1"');
    expect(page).toContain('name="state" value="s1"');
    expect(page).toContain('name="redirect_uri" value="https://localhost:3443/auth/callback"');
    expect(page).toContain("Send code");
  });

  it("escapes an injected state, redirect_uri and e-mail on the sign-in form", () => {
    for (const payload of INJECTIONS) {
      const page = signInPage({
        ...base,
        action: "/authorize/email",
        csrfToken: "tok",
        email: payload,
        hidden: { state: payload, redirect_uri: payload, client_id: payload },
      });
      expectNoInjectedMarkup(page, payload);
      // Escaped, not dropped: the form still renders and the value is still there, entity-encoded.
      expect(page).toContain("Send code");
      expect(page).toMatch(/&(lt|quot|#39);/);
    }
  });

  it("names no e-mail address on the code page, so a known and an unknown address look the same", () => {
    const one = enterCodePage({
      ...base,
      action: "/authorize/verify",
      csrfToken: "tok",
      hidden: { state: "s" },
      expiresInMinutes: 10,
    });
    expect(one).toContain("If that address has an account");
    // No address anywhere in the document: the page cannot say whether the one typed exists.
    expect(one).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  });

  it("escapes an injected user_code on the approve screen and shows the row's platform", () => {
    for (const payload of INJECTIONS) {
      const page = approvePage({
        ...base,
        action: "/auth/device/approve",
        csrfToken: "tok",
        userCode: payload,
        platform: payload,
        deviceLabel: payload,
      });
      expectNoInjectedMarkup(page, payload);
      expect(page).toContain("Only continue if you just started a sign-in on that device.");
    }
  });

  it("offers approve and deny as two separate posts", () => {
    const page = approvePage({
      ...base,
      action: "/auth/device/approve",
      csrfToken: "tok",
      userCode: "K7M4-PQ9T",
      platform: "Windows",
      deviceLabel: "Windows device",
    });
    expect(page).toContain('name="decision" value="approve"');
    expect(page).toContain('name="decision" value="deny"');
    expect(page).toContain("K7M4-PQ9T");
  });

  it("prefills an injected ?code= on the activate form without executing it", () => {
    const page = userCodePage({ ...base, action: "/activate", csrfToken: "tok", userCode: INJECTIONS[0] });
    expect(page).not.toContain(INJECTIONS[0]);
    expect(page).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("renders every page as a complete document in the negotiated locale", () => {
    const page = errorPage({ locale: "id", t: translator("id"), message: translator("id")("error.generic") });
    expect(page.startsWith("<!doctype html>")).toBe(true);
    expect(page).toContain('<html lang="id">');
    expect(page).toContain("Terjadi kesalahan");
    expect(page).toContain("DPSBuddy");
    // The mark rides in the shell, so every screen carries it, not only the sign-in one.
    expect(page).toContain('<img src="/assets/logo.png" alt="DPSBuddy" width="24" height="24">');
  });
});
