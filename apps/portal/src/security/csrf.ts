/**
 * CSRF for the portal's own HTML forms.
 *
 * Double submit: a random token in an `HttpOnly` cookie and the same token in a hidden field.
 * `HttpOnly` is fine here because nothing reads the cookie in the browser -- the server puts the
 * value into the form when it renders the page, and compares the two halves on the post.
 *
 * Every form the portal renders carries one, including the ones posted *before* anyone is signed
 * in: the sign-in form and the code form both mutate state (they send mail, they burn an OTP
 * attempt), so leaving them unprotected would let any page on the internet spend a user's three
 * sends per fifteen minutes.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export function mintCsrfToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Constant time, and an absent half is never equal to anything. */
export function csrfMatches(cookieValue: string | undefined, formValue: unknown): boolean {
  if (typeof cookieValue !== "string" || cookieValue === "") {
    return false;
  }
  if (typeof formValue !== "string" || formValue === "") {
    return false;
  }
  const a = Buffer.from(cookieValue, "utf8");
  const b = Buffer.from(formValue, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
