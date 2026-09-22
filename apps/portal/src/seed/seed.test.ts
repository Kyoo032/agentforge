/** `pnpm portal:seed` — idempotent, and the client secret is shown exactly once. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestStore, type TestStore } from "../testing/pg";
import type { PortalStore } from "../store/types";
import { parseSeedArgs, SeedArgsError } from "./args";
import { formatSeedReport, runSeed } from "./seed";

let harness: TestStore;
let store: PortalStore;

beforeAll(async () => {
  harness = await createTestStore();
  store = harness.store;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

const ARGS = ["--email", "kyo@example.test", "--tenant", "dpsbuddy", "--org", "Kyo"];

describe("parseSeedArgs", () => {
  it("fills in the documented defaults", () => {
    const args = parseSeedArgs(["--email", "kyo@example.test"]);
    expect(args.tenantSlug).toBe("dpsbuddy");
    // `null`, not the slug: "the operator asked for no name" and "the operator asked for this
    // name" have to be two different values, or a re-run without the flag would reset the name.
    expect(args.tenantName).toBeNull();
    expect(parseSeedArgs(["--email", "kyo@example.test", "--tenant-name", " Kyo Co "]).tenantName).toBe("Kyo Co");
    expect(args.orgName).toBe("Kyo");
    expect(args.seatCap).toBe(20);
    expect(args.clientId).toBe("dpsbuddy-web");
    expect(args.redirectUris).toEqual(["https://localhost:3443/auth/callback"]);
  });

  it("takes --redirect more than once", () => {
    const args = parseSeedArgs([
      ...ARGS,
      "--redirect",
      "https://localhost:3443/auth/callback",
      "--redirect",
      "https://app.example.test/auth/callback",
    ]);
    expect(args.redirectUris).toHaveLength(2);
  });

  it("accepts --key=value as well as --key value", () => {
    expect(parseSeedArgs(["--email=kyo@example.test", "--seat-cap=5"]).seatCap).toBe(5);
  });

  it("refuses a missing address, a bad tenant slug and a bad seat cap", () => {
    expect(() => parseSeedArgs([])).toThrow(SeedArgsError);
    expect(() => parseSeedArgs(["--email", "kyo@example.test", "--tenant", "Not A Slug"])).toThrow(
      /tenants_slug_format_chk/,
    );
    expect(() => parseSeedArgs(["--email", "kyo@example.test", "--seat-cap", "0"])).toThrow(/seat-cap/);
    expect(() => parseSeedArgs(["--email", "kyo@example.test", "--redirect", "not a uri"])).toThrow(
      /absolute URI/,
    );
  });

  /**
   * SR-40. `--redirect` took any absolute URI, so `javascript:` and `data:` could be seeded into a
   * client's allowlist -- and `/authorize` exact-matches that allowlist and then redirects to it.
   * The allowlist is the last thing standing between a stolen `client_id` and an authorization
   * code, so the scheme rule belongs at the point the row is written, not only at the point it is
   * read.
   */
  it("refuses a --redirect that is not https, or http off loopback", () => {
    for (const uri of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///C:/Windows/System32",
      "http://evil.example/auth/callback",
      "ftp://example.test/cb",
    ]) {
      expect(() => parseSeedArgs([...ARGS, "--redirect", uri]), uri).toThrow(/https/);
    }
  });

  it("accepts https anywhere and http on loopback", () => {
    for (const uri of [
      "https://app.example.test/auth/callback",
      "http://127.0.0.1:3100/auth/callback",
      "http://localhost:3100/auth/callback",
      "http://[::1]:3100/auth/callback",
    ]) {
      expect(parseSeedArgs([...ARGS, "--redirect", uri]).redirectUris, uri).toEqual([uri]);
    }
  });
});

describe("runSeed", () => {
  it("creates the tenant, org, user and client, and prints the secret once", async () => {
    const first = await runSeed(store, parseSeedArgs(ARGS));
    expect(first.created).toEqual({ tenant: true, org: true, user: true, client: true, secretRotated: false });
    expect(first.clientSecret).toBeTruthy();
    expect(first.seatCap).toBe(20);

    const report = formatSeedReport(first);
    expect(report).toContain(String(first.clientSecret));
    expect(report).toContain("shown once");
  });

  it("is idempotent: a second run creates nothing and shows no secret", async () => {
    const again = await runSeed(store, parseSeedArgs(ARGS));
    expect(again.created).toEqual({ tenant: false, org: false, user: false, client: false, secretRotated: false });
    expect(again.clientSecret).toBeNull();

    const report = formatSeedReport(again);
    expect(report).toContain("already exists");
    expect(report).toContain("--rotate-secret");
  });

  it("keeps the same ids across runs", async () => {
    const first = await runSeed(store, parseSeedArgs(ARGS));
    const second = await runSeed(store, parseSeedArgs(ARGS));
    expect(second.tenantId).toBe(first.tenantId);
    expect(second.orgId).toBe(first.orgId);
    expect(second.userId).toBe(first.userId);
  });

  it("rotates the secret on request, invalidating the previous one", async () => {
    const before = await runSeed(store, parseSeedArgs(ARGS));
    expect(before.clientSecret).toBeNull();

    const rotated = await runSeed(store, parseSeedArgs([...ARGS, "--rotate-secret"]));
    expect(rotated.clientSecret).toBeTruthy();
    expect(rotated.created.secretRotated).toBe(true);
    expect(formatSeedReport(rotated)).toContain("rotated");

    const verified = await store.tx(rotated.tenantId, (ops) =>
      ops.oauthClients.verifySecret(rotated.clientId, String(rotated.clientSecret)),
    );
    expect(verified).toBe(true);
  });

  it("adds a --redirect to an existing client without touching its secret", async () => {
    // A known-good secret first, so "the secret still works afterwards" is an assertion and not
    // an assumption. This is the review instance's real problem: the client is seeded against
    // https://localhost:3443/auth/callback and then has to learn the tunnel's callback too,
    // while AGENTFORGE_PORTAL_CLIENT_SECRET in review.env stays exactly as it is.
    const rotated = await runSeed(store, parseSeedArgs([...ARGS, "--rotate-secret"]));
    const secret = String(rotated.clientSecret);
    const added = "https://review.example.test/auth/callback";

    const result = await runSeed(
      store,
      parseSeedArgs([...ARGS, "--redirect", "https://localhost:3443/auth/callback", "--redirect", added]),
    );

    expect(result.clientSecret).toBeNull();
    expect(result.created.secretRotated).toBe(false);
    expect(result.redirectsAdded).toEqual([added]);
    expect(result.redirectUris).toContain(added);
    expect(result.redirectUris).toContain("https://localhost:3443/auth/callback");

    const [stillValid, allowed] = await store.tx(result.tenantId, async (ops) => [
      await ops.oauthClients.verifySecret(result.clientId, secret),
      await ops.oauthClients.allowsRedirect(result.clientId, added),
    ]);
    expect(stillValid).toBe(true);
    expect(allowed).toBe(true);
    expect(formatSeedReport(result)).toContain(added);
  });

  it("never drops a redirect a previous run registered", async () => {
    const kept = "https://review.example.test/auth/callback";
    // The default list only — exactly what `-Stop`-and-relaunch on localhost would pass.
    const result = await runSeed(store, parseSeedArgs(ARGS));
    expect(result.redirectUris).toContain(kept);
    expect(result.redirectsAdded).toEqual([]);
  });

  it("applies a changed --seat-cap to the existing org", async () => {
    const result = await runSeed(store, parseSeedArgs([...ARGS, "--seat-cap", "50"]));
    expect(result.seatCap).toBe(50);
    expect(result.created.org).toBe(false);

    const org = await store.tx(result.tenantId, (ops) => ops.orgs.findById(result.orgId));
    expect(org?.seatCap).toBe(50);
    // orgs_seat_band_chk wants seat_band >= seat_cap; raising one raises the other.
    expect(org?.seatBand).toBeGreaterThanOrEqual(50);
  });

  /**
   * Renaming an EXISTING tenant, which the seed could not do before.
   *
   * The review instance's tenant was seeded with no `--tenant-name`, so its display name and its
   * `branding.product_name` were both the slug -- and the 2026-09-21 rebrand needed that row to say
   * DPSBuddy. Every other correction the operator makes here (`--seat-cap`, `--redirect`) already
   * applies on a re-run; the name was the one field where "run the seed again" silently did
   * nothing, which leaves a hand-written UPDATE against a live database as the only way, and that
   * is how data goes missing.
   */
  it("applies a --tenant-name to an existing tenant, name and branding together", async () => {
    const result = await runSeed(store, parseSeedArgs([...ARGS, "--tenant-name", "DPSBuddy"]));
    expect(result.created.tenant).toBe(false);
    expect(result.tenantRenamed).toBe(true);
    expect(result.tenantName).toBe("DPSBuddy");

    const [tenant, config] = await store.tx(result.tenantId, async (ops) => [
      await ops.tenants.findById(result.tenantId),
      await ops.tenantConfig.get(result.tenantId),
    ]);
    expect(tenant?.name).toBe("DPSBuddy");
    // Both, because `otp/product-name.ts` reads branding FIRST and would otherwise keep printing
    // the old value out of a row nobody thought to look at.
    expect(config?.branding.product_name).toBe("DPSBuddy");
    expect(formatSeedReport(result)).toContain("DPSBuddy");
  });

  it("is idempotent about the rename: asking for the name it already has changes nothing", async () => {
    const again = await runSeed(store, parseSeedArgs([...ARGS, "--tenant-name", "DPSBuddy"]));
    expect(again.tenantRenamed).toBe(false);
    expect(again.tenantName).toBe("DPSBuddy");
  });

  /** The dangerous one: a re-run without the flag must not reset the name back to the slug. */
  it("leaves a chosen name alone when a later run passes no --tenant-name", async () => {
    const result = await runSeed(store, parseSeedArgs(ARGS));
    expect(result.tenantRenamed).toBe(false);
    expect(result.tenantName).toBe("DPSBuddy");

    const tenant = await store.tx(result.tenantId, (ops) => ops.tenants.findById(result.tenantId));
    expect(tenant?.name).toBe("DPSBuddy");
  });

  it("keeps the rest of branding when it rewrites product_name", async () => {
    const seeded = await runSeed(store, parseSeedArgs(ARGS));
    await store.tx(seeded.tenantId, (ops) =>
      ops.tenantConfig.upsert({
        tenantId: seeded.tenantId,
        branding: { product_name: "DPSBuddy", accent: "#1b4ee0" },
      }),
    );

    const renamed = await runSeed(store, parseSeedArgs([...ARGS, "--tenant-name", "DPSBuddy Review"]));
    expect(renamed.tenantRenamed).toBe(true);

    const config = await store.tx(renamed.tenantId, (ops) => ops.tenantConfig.get(renamed.tenantId));
    expect(config?.branding.product_name).toBe("DPSBuddy Review");
    // A rename is not a reset: a branding key this lane knows nothing about survives it.
    expect(config?.branding.accent).toBe("#1b4ee0");

    // Put the row back the way the rest of this file expects to find it.
    await runSeed(store, parseSeedArgs([...ARGS, "--tenant-name", "DPSBuddy"]));
  });

  it("seeds an active owner, because there is no invitation flow", async () => {
    const result = await runSeed(store, parseSeedArgs(ARGS));
    const user = await store.tx(result.tenantId, (ops) => ops.users.findById(result.userId));
    expect(user?.status).toBe("active");
    expect(user?.role).toBe("owner");
  });

  it("gives a new tenant a config row", async () => {
    const result = await runSeed(store, parseSeedArgs(["--email", "other@example.test", "--tenant", "metranet"]));
    const config = await store.tx(result.tenantId, (ops) => ops.tenantConfig.get(result.tenantId));
    expect(config).not.toBeNull();
    expect(config?.featureFlags.sso_provider).toBeNull();
    expect(config?.featureFlags.allow_byo_key).toBe(true);
  });

  it("leaves an audit trail", async () => {
    const result = await runSeed(store, parseSeedArgs(ARGS));
    const entries = await store.tx(result.tenantId, (ops) =>
      ops.audit.list({ tenantId: result.tenantId, action: "portal.seeded" }),
    );
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].actorKind).toBe("system");
  });
});
