import { describe, expect, it } from "vitest";
import en from "../locales/en/common.json";
import id from "../locales/id/common.json";

function keysOf(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("common locale catalogs", () => {
  it("keeps en and id key trees aligned", () => {
    expect(keysOf(id).sort()).toEqual(keysOf(en).sort());
  });

  it("translates the shared job chrome into Indonesian", () => {
    expect(id.jobProgress.starting).toBe("Memulai…");
    expect(id.artifactActions.sendToKb).toContain("Basis Pengetahuan");
    expect(id.modeHandoff.document).toContain("{subject}");
    expect(id.modeHandoff.presentation).toContain("{subject}");
  });
});
