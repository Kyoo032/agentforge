/**
 * The portal's environment, validated once at boot and never read from `process.env` again.
 *
 * Fail fast, and say what to do. Every message names the variable, what was wrong with it, and
 * the shape that would have been accepted — a service that refuses to start with "invalid config"
 * costs more than one that refuses to start with a sentence.
 *
 * Note the variable names: the portal owns `PORTAL_DATABASE_URL` and never reads `DATABASE_URL`.
 * The product's SQLite desk and the portal's control plane are different databases belonging to
 * different teams, and one env var that means both is how they end up pointed at each other.
 */
import { isAbsolute, resolve } from "node:path";
import { isLoopbackHost } from "./security/cookies";

export class PortalConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Portal configuration is not usable:\n  - ${problems.join("\n  - ")}`);
    this.name = "PortalConfigError";
    this.problems = Object.freeze([...problems]);
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  /** Implicit TLS from the first byte — port 465. `PORTAL_SMTP_SECURE=1`. */
  readonly secure: boolean;
  /**
   * STARTTLS, and refuse to send if the server will not upgrade. True for every host that is not
   * loopback and is not already on implicit TLS, because the alternative is handing an OTP and the
   * SMTP AUTH credentials to anything on the path.
   */
  readonly requireTls: boolean;
  /** Do not even attempt STARTTLS. Mailpit on loopback, and nothing else. */
  readonly ignoreTls: boolean;
  readonly user: string | null;
  readonly pass: string | null;
  readonly from: string;
}

export interface PortalConfig {
  readonly production: boolean;
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly databaseUrl: string;
  /** The Ed25519 seed that signs access tokens. Required in production; lane B mints the JWTs. */
  readonly signingKey: Buffer | null;
  /** Dev convenience switch. Refused in production, where a real mail provider is the only path. */
  readonly devOutbox: boolean;
  /** Lets `pnpm portal:otp <email>` mint a code for an operator to read out. Never in production. */
  readonly allowManualOtp: boolean;
  /**
   * The origin a BROWSER reaches this portal on — `scheme://host[:port]`, never a path.
   *
   * It is the access token's `iss`, the device flow's `verification_uri`, and the fact
   * `security/cookies.ts` reads to decide whether the session cookie must be `Secure`. Required in
   * production: a token minted with the wrong issuer verifies nowhere, and a guessed one is worse
   * than a refusal at boot. `null` outside production means "the bind address is also the public
   * one", which is true of the loopback review instance.
   */
  readonly publicUrl: string | null;
  /** `X-Forwarded-For` is believed only when this is on. Every rate-limit bucket keys on it. */
  readonly trustProxy: boolean;
  readonly smtp: SmtpConfig;
}

const DEFAULT_PORT = 4000;
/** Loopback by default: the portal sits behind the same reverse proxy as everything else. */
const DEFAULT_HOST = "127.0.0.1";
/** Mailpit, from `apps/portal/compose.yml`. Explicitly refused in production. */
const DEFAULT_SMTP_HOST = "127.0.0.1";
const DEFAULT_SMTP_PORT = 1025;
/**
 * The display name on the sign-in mail. DPSBuddy, like every other surface -- this used to carry a
 * third name, different again from the subject line and from the page under it, which is the same
 * two-names-one-flow bug `src/otp/product-name.ts` was written for, one header higher up.
 * `src/views/brand.test.ts` is the guard that keeps all of them one name.
 */
const DEFAULT_SMTP_FROM = "DPSBuddy <no-reply@portal.localhost>";
const SIGNING_KEY_BYTES = 32;

function readFlag(env: Env, name: string, problems: string[]): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  problems.push(`${name} must be 1 or 0 (got ${JSON.stringify(raw)})`);
  return false;
}

function readPort(env: Env, name: string, fallback: number, problems: string[]): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  // 0 is allowed and means "let the OS pick a free one" — that is how the test suite avoids two
  // suites colliding on a fixed port, and it is a real thing to want behind a proxy.
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    problems.push(`${name} must be a TCP port between 0 and 65535 (got ${JSON.stringify(raw)})`);
    return fallback;
  }
  return value;
}

/**
 * The only accepted shape is a Postgres DSN. A sqlite path or a bare file name used to be a
 * tempting shortcut here; it is refused with the reason rather than silently treated as a host,
 * which is how you end up with a service that starts and then fails on its first query.
 */
function readDatabaseUrl(env: Env, problems: string[]): string {
  const raw = env.PORTAL_DATABASE_URL?.trim();
  if (!raw) {
    problems.push(
      "PORTAL_DATABASE_URL is required and must be a Postgres DSN, " +
        "e.g. postgres://portal:portal@127.0.0.1:5433/tokotoken_portal " +
        "(apps/portal/compose.yml starts one). The portal never reads DATABASE_URL.",
    );
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    problems.push(`PORTAL_DATABASE_URL is not a URL (got ${JSON.stringify(raw)})`);
    return "";
  }
  if (parsed.protocol === "sqlite:" || parsed.protocol === "file:") {
    problems.push(
      "PORTAL_DATABASE_URL must be postgres://; SQLite is not supported. " +
        "The portal runs docs/internal/portal/migrations/0001-0005 unchanged, and those files are " +
        "PostgreSQL 16 (RLS policies, plpgsql functions, partitioned usage).",
    );
    return "";
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    problems.push(
      `PORTAL_DATABASE_URL must start with postgres:// or postgresql:// (got ${parsed.protocol}//…)`,
    );
    return "";
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    problems.push("PORTAL_DATABASE_URL must name a database, e.g. …:5433/tokotoken_portal");
    return "";
  }
  return raw;
}

/** base64url, base64 or hex, decoding to exactly 32 bytes — an Ed25519 seed. */
function readSigningKey(env: Env, production: boolean, problems: string[]): Buffer | null {
  const raw = env.PORTAL_SIGNING_KEY?.trim();
  if (!raw) {
    if (production) {
      problems.push(
        "PORTAL_SIGNING_KEY is required in production: 32 bytes, base64url, base64 or hex " +
          "(`node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"`).",
      );
    }
    return null;
  }
  const decoded = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64url");
  if (decoded.length !== SIGNING_KEY_BYTES) {
    problems.push(
      `PORTAL_SIGNING_KEY must decode to exactly ${SIGNING_KEY_BYTES} bytes ` +
        `(got ${decoded.length}; accepted encodings are base64url, base64 and hex)`,
    );
    return null;
  }
  return decoded;
}

function readDataDir(env: Env, problems: string[]): string {
  const raw = env.PORTAL_DATA_DIR?.trim();
  if (!raw) {
    problems.push("PORTAL_DATA_DIR is required: an absolute path the portal may write to");
    return "";
  }
  const absolute = isAbsolute(raw) ? raw : resolve(raw);
  if (!isAbsolute(absolute)) {
    problems.push(`PORTAL_DATA_DIR must be an absolute path (got ${JSON.stringify(raw)})`);
    return "";
  }
  return absolute;
}

/**
 * The transport's TLS decision, made once here instead of in `mail/smtp.ts`.
 *
 * The bug this replaces: the transport passed `ignoreTLS: !secure`, which tells nodemailer to skip
 * STARTTLS **even when the server advertises it**. A provider on 587 therefore received the sign-in
 * code and the SMTP AUTH user and password in cleartext. There are exactly two honest states — TLS
 * from the first byte (`secure`, port 465), or STARTTLS that must succeed (`requireTls`) — and one
 * exception, a loopback sandbox that speaks no TLS at all (Mailpit).
 */
function readSmtp(env: Env, production: boolean, problems: string[]): SmtpConfig {
  const host = env.PORTAL_SMTP_HOST?.trim() || DEFAULT_SMTP_HOST;
  const port = readPort(env, "PORTAL_SMTP_PORT", DEFAULT_SMTP_PORT, problems);
  const secure = readFlag(env, "PORTAL_SMTP_SECURE", problems);
  const user = env.PORTAL_SMTP_USER?.trim() || null;
  const pass = env.PORTAL_SMTP_PASS?.trim() || null;
  const from = env.PORTAL_SMTP_FROM?.trim() || DEFAULT_SMTP_FROM;
  const loopback = isLoopbackHost(host);
  const requireTls = !secure && !loopback;
  const ignoreTls = !secure && loopback;

  if (production && !env.PORTAL_SMTP_HOST?.trim()) {
    // "In production mode with no mail provider the portal refuses to send rather than logging a
    // code" (web-phase9-portal-login.md). Refusing at boot is the same rule, earlier.
    problems.push(
      "PORTAL_SMTP_HOST is required in production: the Mailpit default (127.0.0.1:1025) is a " +
        "sandbox, and a portal that cannot deliver a code must not start pretending it can.",
    );
  }
  if (production && ignoreTls) {
    problems.push(
      `PORTAL_SMTP_HOST is a loopback address (${host}), so the portal would send sign-in codes ` +
        "and SMTP AUTH credentials without TLS. Point it at a real provider, or set " +
        "PORTAL_SMTP_SECURE=1 if that loopback listener really does speak implicit TLS.",
    );
  }
  if (user && !pass) {
    problems.push("PORTAL_SMTP_USER is set without PORTAL_SMTP_PASS");
  }
  if (from && !from.includes("@")) {
    problems.push(`PORTAL_SMTP_FROM must contain an address (got ${JSON.stringify(from)})`);
  }
  return Object.freeze({ host, port, secure, requireTls, ignoreTls, user, pass, from });
}

/**
 * `PORTAL_PUBLIC_URL` — an ORIGIN, not a URL.
 *
 * https anywhere, http on loopback only: the same rule the product applies to its own public
 * origin (`packages/host/src/auth/portal-config.ts`). A path, a query, a fragment or embedded
 * credentials are refused rather than trimmed, because every one of them means the deployment
 * believes something about this value that the code does not — and the value ends up as the `iss`
 * of every access token and as the `verification_uri` printed on a device.
 */
function readPublicUrl(env: Env, production: boolean, problems: string[]): string | null {
  const raw = env.PORTAL_PUBLIC_URL?.trim();
  if (!raw) {
    if (production) {
      problems.push(
        "PORTAL_PUBLIC_URL is required in production: it is the access token's `iss` and the " +
          "device flow's verification_uri, e.g. https://portal.tokotokenai.com",
      );
    }
    return null;
  }

  const refuse = (why: string): null => {
    problems.push(`PORTAL_PUBLIC_URL ${why} (got ${JSON.stringify(raw)})`);
    return null;
  };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("is not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return refuse("must be http or https");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    return refuse("must be https off loopback");
  }
  if (url.username || url.password) {
    return refuse("must carry no credentials");
  }
  if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) {
    return refuse("must be an origin with no path, query or fragment, e.g. https://portal.example.com");
  }
  return url.origin;
}

export function loadConfig(env: Env = process.env): PortalConfig {
  const problems: string[] = [];
  const production = env.NODE_ENV?.trim() === "production";

  const config: PortalConfig = {
    production,
    host: env.PORTAL_HOST?.trim() || DEFAULT_HOST,
    port: readPort(env, "PORTAL_PORT", DEFAULT_PORT, problems),
    dataDir: readDataDir(env, problems),
    databaseUrl: readDatabaseUrl(env, problems),
    signingKey: readSigningKey(env, production, problems),
    devOutbox: readFlag(env, "PORTAL_DEV_OUTBOX", problems),
    allowManualOtp: readFlag(env, "PORTAL_ALLOW_MANUAL_OTP", problems),
    publicUrl: readPublicUrl(env, production, problems),
    trustProxy: readFlag(env, "PORTAL_TRUST_PROXY", problems),
    smtp: readSmtp(env, production, problems),
  };

  if (production && config.devOutbox) {
    problems.push("PORTAL_DEV_OUTBOX is a development switch and must not be set in production");
  }
  if (production && config.allowManualOtp) {
    problems.push(
      "PORTAL_ALLOW_MANUAL_OTP hands a live sign-in code to whoever runs the CLI and must not be " +
        "set in production",
    );
  }

  if (problems.length > 0) {
    throw new PortalConfigError(problems);
  }
  return Object.freeze({ ...config, smtp: config.smtp });
}
