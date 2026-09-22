/**
 * The five screens.
 *
 *   sign-in (e-mail) -> enter code -> [approve a device] -> success | neutral error
 *
 * Every screen is a `<form method="post">` with a hidden CSRF field and whatever the flow has to
 * carry forward. Nothing is stored in a URL that does not have to be: `state`, `client_id` and
 * `redirect_uri` ride in hidden fields across the two posts rather than in the query string, so
 * they never reach a browser history entry or a `Referer` -- and they are **re-validated** on
 * every post regardless, because a hidden field is a field the user controls.
 *
 * The device details on the approve screen come from the `device_codes` row, never from the query.
 * `device-code-login.md` is explicit about that: the browser is a different party from the device,
 * and must not be able to restate what the device claimed.
 */
import { html, type SafeHtml } from "./escape";
import type { PortalLocale, Translate } from "./i18n";
import { page } from "./layout";

export interface ScreenBase {
  readonly locale: PortalLocale;
  readonly t: Translate;
}

/** Hidden inputs, escaped by the tag like everything else. */
function hiddenFields(fields: Readonly<Record<string, string>>): SafeHtml {
  return html`${Object.entries(fields).map(
    ([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`,
  )}`;
}

function errorLine(message: string | undefined): SafeHtml | string {
  return message ? html`<p class="bad">${message}</p>` : "";
}

export interface SignInScreen extends ScreenBase {
  readonly action: string;
  readonly csrfToken: string;
  readonly hidden: Readonly<Record<string, string>>;
  readonly error?: string;
  readonly email?: string;
}

export function signInPage(screen: SignInScreen): string {
  const { t } = screen;
  return page({
    locale: screen.locale,
    product: t("product"),
    title: t("signIn.title"),
    footer: t("footer.note"),
    body: html`<h1>${t("signIn.title")}</h1>
<p class="lead">${t("signIn.intro")}</p>
${errorLine(screen.error)}
<form method="post" action="${screen.action}">
${hiddenFields({ ...screen.hidden, csrf_token: screen.csrfToken })}
<label for="email">${t("signIn.emailLabel")}</label>
<input id="email" name="email" type="email" autocomplete="email" inputmode="email" required
 autofocus maxlength="254" value="${screen.email ?? ""}">
<button type="submit">${t("signIn.submit")}</button>
</form>`,
  });
}

export interface EnterCodeScreen extends ScreenBase {
  readonly action: string;
  readonly csrfToken: string;
  readonly hidden: Readonly<Record<string, string>>;
  readonly expiresInMinutes: number;
  readonly error?: string;
}

/**
 * The same page whether or not a code was actually sent. The body never names the address: it says
 * "if that address has an account", which is what makes an unknown e-mail and a real one produce
 * byte-identical HTML.
 */
export function enterCodePage(screen: EnterCodeScreen): string {
  const { t } = screen;
  return page({
    locale: screen.locale,
    product: t("product"),
    title: t("sent.title"),
    footer: t("footer.note"),
    body: html`<h1>${t("sent.title")}</h1>
<p class="lead">${t("sent.body", { minutes: screen.expiresInMinutes })}</p>
${errorLine(screen.error)}
<form method="post" action="${screen.action}">
${hiddenFields({ ...screen.hidden, csrf_token: screen.csrfToken })}
<label for="code">${t("sent.codeLabel")}</label>
<input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"
 autocomplete="one-time-code" required autofocus>
<button type="submit">${t("sent.submit")}</button>
</form>`,
  });
}

export interface UserCodeScreen extends ScreenBase {
  readonly action: string;
  readonly csrfToken: string;
  readonly userCode?: string;
  readonly error?: string;
}

/** `GET /activate` with no usable `?code=`: ask for the code shown on the device. */
export function userCodePage(screen: UserCodeScreen): string {
  const { t } = screen;
  return page({
    locale: screen.locale,
    product: t("product"),
    title: t("approve.title"),
    footer: t("footer.note"),
    body: html`<h1>${t("approve.title")}</h1>
<p class="lead">${t("approve.codeIntro")}</p>
${errorLine(screen.error)}
<form method="post" action="${screen.action}">
${hiddenFields({ csrf_token: screen.csrfToken })}
<label for="user_code">${t("approve.codeLabel")}</label>
<input id="user_code" name="user_code" type="text" maxlength="9" autocomplete="off"
 spellcheck="false" required autofocus value="${screen.userCode ?? ""}">
<button type="submit">${t("approve.codeSubmit")}</button>
</form>`,
  });
}

export interface ApproveScreen extends ScreenBase {
  readonly action: string;
  readonly csrfToken: string;
  /** From the `device_codes` row -- displayed `XXXX-XXXX`. */
  readonly userCode: string;
  /** From the row's `platform` column, already mapped to a copy key. */
  readonly platform: string;
  readonly deviceLabel: string | null;
}

export function approvePage(screen: ApproveScreen): string {
  const { t } = screen;
  return page({
    locale: screen.locale,
    product: t("product"),
    title: t("approve.title"),
    footer: t("footer.note"),
    body: html`<h1>${t("approve.title")}</h1>
<p class="lead">${t("approve.intro")}</p>
<dl>
<dt>${t("approve.userCode")}</dt><dd class="code">${screen.userCode}</dd>
<dt>${t("approve.platform")}</dt><dd>${screen.platform}</dd>
${screen.deviceLabel ? html`<dt>${t("approve.device")}</dt><dd>${screen.deviceLabel}</dd>` : ""}
</dl>
<p class="warn">${t("approve.warning")}</p>
<form method="post" action="${screen.action}">
${hiddenFields({ csrf_token: screen.csrfToken, user_code: screen.userCode, decision: "approve" })}
<button type="submit">${t("approve.approve")}</button>
</form>
<form method="post" action="${screen.action}">
${hiddenFields({ csrf_token: screen.csrfToken, user_code: screen.userCode, decision: "deny" })}
<button class="secondary" type="submit">${t("approve.deny")}</button>
</form>`,
  });
}

export interface OutcomeScreen extends ScreenBase {
  readonly title: string;
  readonly message: string;
}

/** Approved, denied, signed in, and every neutral refusal. One shape, no CTA to get wrong. */
export function outcomePage(screen: OutcomeScreen): string {
  const { t } = screen;
  return page({
    locale: screen.locale,
    product: t("product"),
    title: screen.title,
    footer: t("footer.note"),
    body: html`<h1>${screen.title}</h1>
<p class="lead">${screen.message}</p>`,
  });
}

/**
 * The one error page. It carries a sentence and nothing else -- no request id, no client id, no
 * `state`, no hint about whether the failure was the client's or the user's.
 */
export function errorPage(screen: ScreenBase & { readonly message: string }): string {
  return outcomePage({
    locale: screen.locale,
    t: screen.t,
    title: screen.t("error.title"),
    message: screen.message,
  });
}
