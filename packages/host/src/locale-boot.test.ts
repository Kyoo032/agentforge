import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBootLocale, getSavedLocale, applySavedLocaleAsBoot, resetBootLocaleForTests } from "./locale-boot";
import { saveOwnerLocale } from "./settings-store";

const SECRET = "a".repeat(64);

describe("locale-boot", () => {
  let dir: string;
  let previousPath: string | undefined;
  let previousKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-locale-"));
    previousPath = process.env.AGENTFORGE_SETTINGS_PATH;
    previousKey = process.env.AGENTFORGE_SECRETS_KEY;
    process.env.AGENTFORGE_SETTINGS_PATH = dir;
    process.env.AGENTFORGE_SECRETS_KEY = SECRET;
    resetBootLocaleForTests();
  });

  afterEach(() => {
    resetBootLocaleForTests();
    if (previousPath === undefined) {
      delete process.env.AGENTFORGE_SETTINGS_PATH;
    } else {
      process.env.AGENTFORGE_SETTINGS_PATH = previousPath;
    }
    if (previousKey === undefined) {
      delete process.env.AGENTFORGE_SECRETS_KEY;
    } else {
      process.env.AGENTFORGE_SECRETS_KEY = previousKey;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("freezes owner settings locale at first read and ignores later saves", () => {
    saveOwnerLocale("id");
    expect(getBootLocale()).toBe("id");
    saveOwnerLocale("en");
    expect(getSavedLocale()).toBe("en");
    expect(getBootLocale()).toBe("id");
    expect(process.env.AGENTFORGE_LOCALE).toBeUndefined();
  });

  it("Restart re-freezes boot locale from the saved value", () => {
    saveOwnerLocale("en");
    expect(getBootLocale()).toBe("en");
    saveOwnerLocale("id");
    expect(getBootLocale()).toBe("en");
    expect(applySavedLocaleAsBoot()).toBe("id");
    expect(getBootLocale()).toBe("id");
  });
});
