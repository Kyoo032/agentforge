/**
 * The access token: compact JWS, EdDSA, one hour.
 *
 * `device-code-login.md`, "Token design", freezes both halves of this -- the header
 * (`{alg: EdDSA, typ: JWT, kid}`) and the claim set (`iss sub tid oid did sid scope iat exp`) --
 * and the gateway verifies it with nothing but the JWKS document, so any extra claim here is a
 * claim nobody reads and a byte of token nobody asked for.
 *
 * `did` is `devices.id`, the **server-side** device id. The client-minted `install_id` never
 * appears in a token; that distinction is the easiest bug to write in this whole flow.
 *
 * Verification is here too, because `/auth/logout` and `/auth/session` take a Bearer token and the
 * portal must not re-derive the rules a second way. ±120 s of skew, matching what the login doc
 * promises the gateway allows.
 */
import { verify as verifySignature } from "node:crypto";
import type { Keyring, PortalKey } from "./keys";

/** One hour. The client refreshes at T-5 min (`device-code-login.md`, "Token design"). */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;
/** "The gateway allows ±120 s on exp/iat" -- the same tolerance, so both halves agree. */
export const CLOCK_SKEW_SECONDS = 120;

export interface AccessClaims {
  readonly iss: string;
  readonly sub: string;
  readonly tid: string;
  readonly oid: string;
  readonly did: string;
  readonly sid: string;
  readonly scope: string;
  readonly iat: number;
  readonly exp: number;
}

export interface SignAccessTokenInput {
  readonly issuer: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly scope: string;
  /** Epoch milliseconds. */
  readonly now: number;
  readonly ttlSeconds?: number;
}

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function signAccessToken(key: PortalKey, input: SignAccessTokenInput): string {
  const issuedAt = Math.floor(input.now / 1000);
  const claims: AccessClaims = {
    iss: input.issuer,
    sub: input.userId,
    tid: input.tenantId,
    oid: input.orgId,
    did: input.deviceId,
    sid: input.sessionId,
    scope: input.scope,
    iat: issuedAt,
    exp: issuedAt + (input.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS),
  };

  const signingInput = `${segment({ alg: "EdDSA", typ: "JWT", kid: key.kid })}.${segment(claims)}`;
  const signature = key.sign(Buffer.from(signingInput, "ascii")).toString("base64url");
  return `${signingInput}.${signature}`;
}

export type VerifyFailure =
  | "malformed"
  | "bad_algorithm"
  | "unknown_kid"
  | "bad_signature"
  | "wrong_issuer"
  | "expired";

export type VerifyResult =
  | { readonly ok: true; readonly claims: AccessClaims }
  | { readonly ok: false; readonly reason: VerifyFailure };

export interface VerifyOptions {
  readonly issuer: string;
  /** Epoch milliseconds. */
  readonly now: number;
}

function parse(segmentText: string): Record<string, unknown> | null {
  try {
    const decoded = Buffer.from(segmentText, "base64url").toString("utf8");
    const value: unknown = JSON.parse(decoded);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function verifyAccessToken(ring: Keyring, token: string, options: VerifyOptions): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part, index) => part === "" && index !== 2)) {
    return { ok: false, reason: "malformed" };
  }
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = parse(rawHeader);
  if (!header) {
    return { ok: false, reason: "malformed" };
  }
  // Checked before the key lookup: an `alg: none` token must never reach a code path that could
  // treat an empty signature as a match.
  if (header.alg !== "EdDSA") {
    return { ok: false, reason: "bad_algorithm" };
  }

  const key = typeof header.kid === "string" ? ring.byKid(header.kid) : null;
  if (!key) {
    return { ok: false, reason: "unknown_kid" };
  }

  const signingInput = Buffer.from(`${rawHeader}.${rawPayload}`, "ascii");
  const signature = Buffer.from(rawSignature, "base64url");
  if (signature.length !== 64 || !verifySignature(null, signingInput, key.publicKey, signature)) {
    return { ok: false, reason: "bad_signature" };
  }

  const claims = parse(rawPayload);
  if (!claims || typeof claims.exp !== "number" || typeof claims.sub !== "string") {
    return { ok: false, reason: "malformed" };
  }
  if (claims.iss !== options.issuer) {
    return { ok: false, reason: "wrong_issuer" };
  }
  if (claims.exp + CLOCK_SKEW_SECONDS < Math.floor(options.now / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, claims: Object.freeze(claims as unknown as AccessClaims) };
}
