import { describe, expect, it } from "vitest";
import en from "../locales/en/legal.json";
import id from "../locales/id/legal.json";

function keysOf(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("legal locale catalogs", () => {
  it("keeps en and id key trees aligned", () => {
    expect(keysOf(id).sort()).toEqual(keysOf(en).sort());
  });

  it("keeps English Legal chrome as the source of truth", () => {
    expect(en.studio.title).toBe("Legal");
    expect(en.studio.run).toBe("Run matter");
    expect(en.errors.stub).toMatch(/live gateway/);
  });

  it("translates Indonesian Legal chrome without dropping keys", () => {
    expect(id.studio.lede).toMatch(/perkara/);
    expect(id.studio.run).toBe("Jalankan perkara");
    expect(id.errors.stub).toMatch(/gerbang yang aktif/);
    expect(id.errors.stub).toContain("Settings");
  });
});
