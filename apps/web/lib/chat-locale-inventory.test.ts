import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");

function flatten(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

describe("chat locale inventory", () => {
  const en = JSON.parse(readFileSync(join(root, "en", "chat.json"), "utf8")) as Record<string, unknown>;
  const id = JSON.parse(readFileSync(join(root, "id", "chat.json"), "utf8")) as Record<string, unknown>;

  it("keeps the same keys in en and id", () => {
    expect(flatten(id).sort()).toEqual(flatten(en).sort());
  });

  it("translates owned copy instead of copying English", () => {
    const english = flatten(en);
    const leftover: string[] = [];
    for (const key of english) {
      const enValue = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en);
      const idValue = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], id);
      if (typeof enValue !== "string" || typeof idValue !== "string") {
        continue;
      }
      if (enValue === idValue && !/^(Chat|Soul|Ultra|Normal|Video|Model)$/.test(enValue) && !enValue.includes("Toko Token")) {
        leftover.push(`${key}: ${idValue}`);
      }
    }
    expect(leftover).toEqual([]);
  });
});
