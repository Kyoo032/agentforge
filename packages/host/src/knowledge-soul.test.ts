import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PRODUCT_NAME } from "@agentforge/core";
import { defaultSoul, isLegacyDefaultSoul, LEGACY_DEFAULT_SOUL } from "./knowledge-soul";

const PRODUCT_ENV = "AGENTFORGE_PRODUCT_NAME";

afterEach(() => {
  delete process.env[PRODUCT_ENV];
});

describe("defaultSoul", () => {
  it("is named after the product, not 'Forge'", () => {
    const soul = defaultSoul();
    expect(soul.name).toBe(DEFAULT_PRODUCT_NAME);
    expect(soul.name).not.toBe("Forge");
    expect(JSON.stringify(soul)).not.toContain("Forge");
  });

  it("follows AGENTFORGE_PRODUCT_NAME for branded flavors", () => {
    process.env[PRODUCT_ENV] = "Kemenkeu AI";
    expect(defaultSoul().name).toBe("Kemenkeu AI");
  });

  it("tells the assistant what the product actually is", () => {
    const text = `${defaultSoul().role}\n${defaultSoul().rules.join("\n")}`;
    expect(text).toContain("Toko Token");
    expect(text).toMatch(/local/i);
    // The mode list is what "what is this?" has to be answerable from.
    for (const mode of [
      "Chat",
      "Documents",
      "Research",
      "Finance",
      "Data",
      "Market",
      "Legal",
      "Images",
      "Videos",
      "Edit",
      "Presentation",
    ]) {
      expect(text).toContain(mode);
    }
    // The privacy claim the owner actually relies on.
    expect(text).toMatch(/stay on this (machine|computer)/i);
  });

  it("keeps the citation rule the old default carried", () => {
    expect(defaultSoul().rules).toContain(LEGACY_DEFAULT_SOUL.rules[0]);
  });

  it("returns a fresh rules array each call so callers cannot mutate the default", () => {
    const first = defaultSoul();
    first.rules.push("mutated");
    expect(defaultSoul().rules).not.toContain("mutated");
  });
});

describe("isLegacyDefaultSoul", () => {
  it("recognizes a desk still holding the old seeded default", () => {
    expect(isLegacyDefaultSoul({ ...LEGACY_DEFAULT_SOUL, rules: [...LEGACY_DEFAULT_SOUL.rules] })).toBe(true);
  });

  it("tolerates stray whitespace the old UI could have saved", () => {
    expect(
      isLegacyDefaultSoul({
        name: " Forge ",
        role: " Desk assistant for this workspace ",
        voice: " Precise, plain-spoken. Cites sources; never pads. ",
        rules: [" Cite a source for every factual claim or say it is an estimate. "],
      }),
    ).toBe(true);
  });

  it("leaves an owner-edited soul alone", () => {
    const edited = { ...LEGACY_DEFAULT_SOUL, rules: [...LEGACY_DEFAULT_SOUL.rules] };
    expect(isLegacyDefaultSoul({ ...edited, name: "Rizky's desk" })).toBe(false);
    expect(isLegacyDefaultSoul({ ...edited, role: "Finance analyst" })).toBe(false);
    expect(isLegacyDefaultSoul({ ...edited, voice: "Warm and chatty" })).toBe(false);
    expect(isLegacyDefaultSoul({ ...edited, rules: [...edited.rules, "Always answer in Bahasa Indonesia."] })).toBe(
      false,
    );
    expect(isLegacyDefaultSoul({ ...edited, rules: [] })).toBe(false);
  });

  it("does not mistake the new default for the old one", () => {
    expect(isLegacyDefaultSoul(defaultSoul())).toBe(false);
  });
});
