import { describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { getSoul, putSoul } from "./knowledge";
import { defaultSoul, LEGACY_DEFAULT_SOUL } from "./knowledge-soul";

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: "org-soul-test",
    workspaceId: `ws-soul-${crypto.randomUUID()}`,
    userId: "user-soul-test",
    role: "owner",
  };
}

function writeSoulRow(ctx: TenantContext, soul: typeof LEGACY_DEFAULT_SOUL): void {
  sql
    .prepare(
      "INSERT INTO knowledge_soul (workspace_id, name, role, voice, rules, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(ctx.workspaceId, soul.name, soul.role, soul.voice, JSON.stringify(soul.rules), Date.now());
}

describe("getSoul", () => {
  it("gives a desk with no row the product Soul", () => {
    expect(getSoul(tenant())).toEqual(defaultSoul());
  });

  it("upgrades a desk still holding the old 'Forge' default", () => {
    const ctx = tenant();
    writeSoulRow(ctx, LEGACY_DEFAULT_SOUL);
    const soul = getSoul(ctx);
    expect(soul).toEqual(defaultSoul());
    expect(soul.name).not.toBe("Forge");
  });

  it("leaves an owner-edited soul alone", () => {
    const ctx = tenant();
    const mine = { ...LEGACY_DEFAULT_SOUL, name: "Rizky's desk", rules: [...LEGACY_DEFAULT_SOUL.rules] };
    writeSoulRow(ctx, mine);
    expect(getSoul(ctx)).toEqual(mine);
  });

  it("does not rewrite the stored row when it upgrades on read", () => {
    const ctx = tenant();
    writeSoulRow(ctx, LEGACY_DEFAULT_SOUL);
    getSoul(ctx);
    const row = sql.prepare("SELECT name FROM knowledge_soul WHERE workspace_id = ?").get(ctx.workspaceId) as
      | { name: string }
      | undefined;
    expect(row?.name).toBe("Forge");
  });
});

describe("putSoul", () => {
  it("falls back to the product Soul for blank fields, never to 'Forge'", () => {
    const ctx = tenant();
    const saved = putSoul(ctx, { name: "  ", role: "", voice: "   ", rules: [] });
    expect(saved).toEqual({ ...defaultSoul(), rules: [] });
    expect(saved.name).toBe(defaultSoul().name);
  });

  it("round-trips what the owner typed", () => {
    const ctx = tenant();
    putSoul(ctx, { name: "Meja Rizky", role: "Analis", voice: "Ringkas", rules: ["Selalu sebut sumber."] });
    expect(getSoul(ctx)).toEqual({
      name: "Meja Rizky",
      role: "Analis",
      voice: "Ringkas",
      rules: ["Selalu sebut sumber."],
    });
  });
});
