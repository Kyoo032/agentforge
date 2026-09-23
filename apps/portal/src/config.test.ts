import { describe, expect, it } from "vitest";
import { loadConfig, PortalConfigError } from "./config";

const BASE = {
  PORTAL_DATA_DIR: "C:/tmp/portal-data",
  PORTAL_DATABASE_URL: "postgres://portal:portal@127.0.0.1:5433/tokotoken_portal",
} as const;

function problemsOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof PortalConfigError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error("expected loadConfig to refuse this environment");
}

describe("loadConfig", () => {
  it("defaults to port 4000 on loopback", () => {
    const config = loadConfig({ ...BASE });
    expect(config.port).toBe(4000);
    expect(config.host).toBe("127.0.0.1");
    expect(config.production).toBe(false);
  });

  it("requires PORTAL_DATA_DIR and PORTAL_DATABASE_URL", () => {
    const problems = problemsOf({});
    expect(problems.some((p) => p.includes("PORTAL_DATA_DIR"))).toBe(true);
    expect(problems.some((p) => p.includes("PORTAL_DATABASE_URL"))).toBe(true);
  });

  it("refuses a sqlite PORTAL_DATABASE_URL and says why", () => {
    const problems = problemsOf({ ...BASE, PORTAL_DATABASE_URL: "sqlite:./portal.db" });
    const message = problems.join("\n");
    expect(message).toContain("must be postgres://");
    expect(message).toContain("not supported");
  });

  it("refuses any non-Postgres scheme", () => {
    expect(problemsOf({ ...BASE, PORTAL_DATABASE_URL: "mysql://x/y" }).join()).toContain(
      "must start with postgres://",
    );
  });

  it("refuses a Postgres URL that names no database", () => {
    expect(problemsOf({ ...BASE, PORTAL_DATABASE_URL: "postgres://user@host:5432/" }).join()).toContain(
      "must name a database",
    );
  });

  it("never falls back to DATABASE_URL", () => {
    const problems = problemsOf({
      PORTAL_DATA_DIR: BASE.PORTAL_DATA_DIR,
      DATABASE_URL: "postgres://somewhere/else",
    });
    expect(problems.some((p) => p.startsWith("PORTAL_DATABASE_URL is required"))).toBe(true);
  });

  it("rejects a port outside 0..65535", () => {
    expect(problemsOf({ ...BASE, PORTAL_PORT: "70000" }).join()).toContain("between 0 and 65535");
    expect(problemsOf({ ...BASE, PORTAL_PORT: "not-a-port" }).join()).toContain("between 0 and 65535");
  });

  it("accepts a 32-byte signing key in base64url or hex, and refuses other lengths", () => {
    const base64url = Buffer.alloc(32, 7).toString("base64url");
    expect(loadConfig({ ...BASE, PORTAL_SIGNING_KEY: base64url }).signingKey?.length).toBe(32);

    const hex = Buffer.alloc(32, 9).toString("hex");
    expect(loadConfig({ ...BASE, PORTAL_SIGNING_KEY: hex }).signingKey?.length).toBe(32);

    expect(problemsOf({ ...BASE, PORTAL_SIGNING_KEY: "too-short" }).join()).toContain(
      "must decode to exactly 32 bytes",
    );
  });

  it("requires a signing key and a real SMTP host in production", () => {
    const problems = problemsOf({ ...BASE, NODE_ENV: "production" });
    expect(problems.some((p) => p.startsWith("PORTAL_SIGNING_KEY is required in production"))).toBe(true);
    expect(problems.some((p) => p.startsWith("PORTAL_SMTP_HOST is required in production"))).toBe(true);
  });

  it("refuses the dev switches in production", () => {
    const problems = problemsOf({
      ...BASE,
      NODE_ENV: "production",
      PORTAL_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64url"),
      PORTAL_PUBLIC_URL: "https://portal.example.com",
      PORTAL_SMTP_HOST: "smtp.example.com",
      PORTAL_DEV_OUTBOX: "1",
      PORTAL_ALLOW_MANUAL_OTP: "1",
    });
    expect(problems.some((p) => p.includes("PORTAL_DEV_OUTBOX"))).toBe(true);
    expect(problems.some((p) => p.includes("PORTAL_ALLOW_MANUAL_OTP"))).toBe(true);
  });

  it("accepts a complete production environment", () => {
    const config = loadConfig({
      ...BASE,
      PORTAL_MIGRATE_DATABASE_URL: "postgres://portal_owner:owner@db.internal:5432/tokotoken_portal",
      NODE_ENV: "production",
      PORTAL_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64url"),
      PORTAL_PUBLIC_URL: "https://portal.example.com",
      PORTAL_SMTP_HOST: "smtp.example.com",
      PORTAL_SMTP_PORT: "587",
      PORTAL_SMTP_SECURE: "0",
      PORTAL_SMTP_USER: "portal",
      PORTAL_SMTP_PASS: "secret",
      PORTAL_SMTP_FROM: "DPSBuddy <no-reply@tokotokenai.com>",
    });
    expect(config.production).toBe(true);
    expect(config.smtp.host).toBe("smtp.example.com");
    expect(config.smtp.port).toBe(587);
    expect(config.allowManualOtp).toBe(false);
    expect(config.databaseUrl).toBe(BASE.PORTAL_DATABASE_URL);
    expect(config.migrateDatabaseUrl).toBe("postgres://portal_owner:owner@db.internal:5432/tokotoken_portal");
  });

  it("defaults SMTP to Mailpit outside production", () => {
    const config = loadConfig({ ...BASE });
    expect(config.smtp.host).toBe("127.0.0.1");
    expect(config.smtp.port).toBe(1025);
  });

  it("refuses a flag that is neither 1 nor 0", () => {
    expect(problemsOf({ ...BASE, PORTAL_DEV_OUTBOX: "maybe" }).join()).toContain("must be 1 or 0");
  });

  it("refuses an SMTP user with no password", () => {
    expect(problemsOf({ ...BASE, PORTAL_SMTP_USER: "portal" }).join()).toContain(
      "PORTAL_SMTP_USER is set without PORTAL_SMTP_PASS",
    );
  });

  it("collects every problem in one error rather than failing on the first", () => {
    const problems = problemsOf({ PORTAL_PORT: "99999", PORTAL_DATABASE_URL: "sqlite:x" });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The portal used to run its migrations and serve its requests on ONE connection. Migrations need
 * the schema owner, and in the compose file that is the cluster superuser, so every request ran as
 * a role that bypasses row-level security. There are two DSNs now: migrations on the owner's, and
 * the server on a plain member of `portal_app`.
 */
describe("PORTAL_MIGRATE_DATABASE_URL", () => {
  const OWNER = "postgres://portal:owner-password@127.0.0.1:5433/tokotoken_portal";

  it("falls back to PORTAL_DATABASE_URL outside production", () => {
    expect(loadConfig({ ...BASE }).migrateDatabaseUrl).toBe(BASE.PORTAL_DATABASE_URL);
  });

  it("is used for migrations when it is set, and the server keeps its own DSN", () => {
    const config = loadConfig({ ...BASE, PORTAL_MIGRATE_DATABASE_URL: OWNER });
    expect(config.migrateDatabaseUrl).toBe(OWNER);
    expect(config.databaseUrl).toBe(BASE.PORTAL_DATABASE_URL);
  });

  it("is validated exactly like PORTAL_DATABASE_URL, and named in its own problems", () => {
    expect(problemsOf({ ...BASE, PORTAL_MIGRATE_DATABASE_URL: "sqlite:./portal.db" }).join()).toContain(
      "PORTAL_MIGRATE_DATABASE_URL must be postgres://",
    );
    expect(problemsOf({ ...BASE, PORTAL_MIGRATE_DATABASE_URL: "mysql://x/y" }).join()).toContain(
      "PORTAL_MIGRATE_DATABASE_URL must start with postgres://",
    );
    expect(problemsOf({ ...BASE, PORTAL_MIGRATE_DATABASE_URL: "postgres://u@h:5432/" }).join()).toContain(
      "PORTAL_MIGRATE_DATABASE_URL must name a database",
    );
  });

  it("is required in production, where the server must not be the schema owner", () => {
    const problems = problemsOf({
      ...BASE,
      NODE_ENV: "production",
      PORTAL_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64url"),
      PORTAL_PUBLIC_URL: "https://portal.example.com",
      PORTAL_SMTP_HOST: "smtp.example.com",
    });
    expect(problems.some((p) => p.startsWith("PORTAL_MIGRATE_DATABASE_URL is required in production"))).toBe(
      true,
    );
  });
});

/**
 * SR-39. The transport used to pass `ignoreTLS: !secure`, which tells nodemailer to skip STARTTLS
 * even when the server offers it -- so a provider on 587 received the OTP and the SMTP AUTH
 * credentials in cleartext. The decision is made here now, once, and the transport only reads it.
 */
describe("SMTP transport security", () => {
  it("requires STARTTLS for a remote host that is not on implicit TLS", () => {
    const smtp = loadConfig({ ...BASE, PORTAL_SMTP_HOST: "smtp.example.com", PORTAL_SMTP_PORT: "587" }).smtp;
    expect(smtp.secure).toBe(false);
    expect(smtp.requireTls).toBe(true);
    expect(smtp.ignoreTls).toBe(false);
  });

  it("asks for neither when the host speaks implicit TLS", () => {
    const smtp = loadConfig({
      ...BASE,
      PORTAL_SMTP_HOST: "smtp.example.com",
      PORTAL_SMTP_PORT: "465",
      PORTAL_SMTP_SECURE: "1",
    }).smtp;
    expect(smtp.secure).toBe(true);
    expect(smtp.requireTls).toBe(false);
    expect(smtp.ignoreTls).toBe(false);
  });

  it("ignores TLS only for a loopback sandbox", () => {
    for (const host of ["127.0.0.1", "localhost", "127.0.0.53", "::1"]) {
      const smtp = loadConfig({ ...BASE, PORTAL_SMTP_HOST: host }).smtp;
      expect(smtp.ignoreTls, host).toBe(true);
      expect(smtp.requireTls, host).toBe(false);
    }
  });

  it("refuses a cleartext loopback mail host in production", () => {
    const problems = problemsOf({
      ...BASE,
      NODE_ENV: "production",
      PORTAL_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64url"),
      PORTAL_PUBLIC_URL: "https://portal.example.com",
      PORTAL_SMTP_HOST: "127.0.0.1",
      PORTAL_SMTP_PORT: "1025",
    });
    expect(problems.join()).toContain("without TLS");
  });
});

/**
 * SR-33. Both of these used to be read where they were used (`flows/context.ts`,
 * `security/client-ip.ts`), so a typo in either was a silently weaker deployment rather than a boot
 * error. The access token's `iss` and the device flow's `verification_uri` are built from the
 * public URL, so a production process without one signs tokens nothing can verify.
 */
describe("PORTAL_PUBLIC_URL and PORTAL_TRUST_PROXY", () => {
  it("is null outside production when nothing is set", () => {
    const config = loadConfig({ ...BASE });
    expect(config.publicUrl).toBeNull();
    expect(config.trustProxy).toBe(false);
  });

  it("accepts an https origin and drops a trailing slash", () => {
    expect(loadConfig({ ...BASE, PORTAL_PUBLIC_URL: "https://portal.example.com/" }).publicUrl).toBe(
      "https://portal.example.com",
    );
  });

  it("accepts http only on loopback", () => {
    expect(loadConfig({ ...BASE, PORTAL_PUBLIC_URL: "http://127.0.0.1:4000" }).publicUrl).toBe(
      "http://127.0.0.1:4000",
    );
    expect(problemsOf({ ...BASE, PORTAL_PUBLIC_URL: "http://portal.example.com" }).join()).toContain(
      "PORTAL_PUBLIC_URL",
    );
  });

  it("refuses a path, a query or a fragment -- it is an origin, not a URL", () => {
    for (const value of [
      "https://portal.example.com/portal",
      "https://portal.example.com/?a=b",
      "https://portal.example.com/#x",
      "https://user:pw@portal.example.com",
      "not-a-url",
      "javascript:alert(1)",
    ]) {
      expect(problemsOf({ ...BASE, PORTAL_PUBLIC_URL: value }).join(), value).toContain("PORTAL_PUBLIC_URL");
    }
  });

  it("requires PORTAL_PUBLIC_URL in production", () => {
    const problems = problemsOf({
      ...BASE,
      NODE_ENV: "production",
      PORTAL_SIGNING_KEY: Buffer.alloc(32, 1).toString("base64url"),
      PORTAL_SMTP_HOST: "smtp.example.com",
    });
    expect(problems.some((p) => p.startsWith("PORTAL_PUBLIC_URL is required in production"))).toBe(true);
  });

  it("reads PORTAL_TRUST_PROXY through the same flag reader, so a typo is a boot error", () => {
    expect(loadConfig({ ...BASE, PORTAL_TRUST_PROXY: "1" }).trustProxy).toBe(true);
    expect(loadConfig({ ...BASE, PORTAL_TRUST_PROXY: "off" }).trustProxy).toBe(false);
    expect(problemsOf({ ...BASE, PORTAL_TRUST_PROXY: "ture" }).join()).toContain(
      "PORTAL_TRUST_PROXY must be 1 or 0",
    );
  });

  it("accepts the running review instance's configuration", () => {
    const config = loadConfig({
      ...BASE,
      PORTAL_PUBLIC_URL: "https://grade-renewable-personnel-john.trycloudflare.com",
      PORTAL_TRUST_PROXY: "1",
      PORTAL_SMTP_HOST: "127.0.0.1",
      PORTAL_SMTP_PORT: "1025",
      PORTAL_ALLOW_MANUAL_OTP: "1",
    });
    expect(config.publicUrl).toBe("https://grade-renewable-personnel-john.trycloudflare.com");
    expect(config.trustProxy).toBe(true);
    expect(config.smtp.ignoreTls).toBe(true);
  });
});
