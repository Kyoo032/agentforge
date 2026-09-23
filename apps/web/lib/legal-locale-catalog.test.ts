import { describe, expect, it } from "vitest";
import en from "../locales/en/legal.json";
import id from "../locales/id/legal.json";
import { legalValidationKey } from "./legal-view";

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
    expect(id.errors.stub).toContain("Pengaturan");
  });

  it("carries every key the host-validation mapping can return, in both locales", () => {
    const messages = [
      "side.party is required",
      "side.counterparty is required",
      "side.role is required",
      "side.party must be 200 characters or fewer",
      "title must be 200 characters or fewer",
      "deliverables must list at least one deliverable",
      "instructions must be 20,000 characters or fewer",
      "workType is invalid",
    ];
    const enKeys = new Set(keysOf(en).map((key) => `legal.${key}`));
    const idKeys = new Set(keysOf(id).map((key) => `legal.${key}`));
    for (const message of messages) {
      const key = legalValidationKey("invalid_request", message);
      expect(key, message).not.toBeNull();
      expect(enKeys.has(key as string), `${key} in en`).toBe(true);
      expect(idKeys.has(key as string), `${key} in id`).toBe(true);
    }
    for (const key of ["legal.files.needParties", "legal.errors.tooLarge", "legal.errors.docxOnly"]) {
      expect(enKeys.has(key), `${key} in en`).toBe(true);
      expect(idKeys.has(key), `${key} in id`).toBe(true);
    }
  });
});
