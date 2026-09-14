import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBootLocaleForTests } from "./locale-boot";
import {
  presentationGatewayMessage,
  presentationKicker,
  presentationLanguageRule,
  presentationLocale,
} from "./presentation-locale";
import { saveOwnerLocale } from "./settings-store";

const SECRET = "a".repeat(64);

describe("presentationLocale", () => {
  let dir: string;
  let previousPath: string | undefined;
  let previousKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-pres-locale-"));
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

  it("defaults to en", () => {
    expect(presentationLocale()).toBe("en");
  });

  it("reads owner locale frozen by i18n core", () => {
    saveOwnerLocale("id");
    expect(presentationLocale()).toBe("id");
    saveOwnerLocale("en");
    expect(presentationLocale()).toBe("id");
  });
});

describe("presentation language copy", () => {
  it("instructs Bahasa Indonesia slide copy for id", () => {
    expect(presentationLanguageRule("id")).toMatch(/Bahasa Indonesia/);
    expect(presentationKicker("id")).toBe("PRESENTASI");
    expect(presentationGatewayMessage("id")).toMatch(/Pengaturan/);
    expect(presentationGatewayMessage("id")).toMatch(/Toko Token/);
  });

  it("keeps English slide copy for en", () => {
    expect(presentationLanguageRule("en")).toMatch(/English/);
    expect(presentationKicker("en")).toBe("PRESENTATION");
    expect(presentationGatewayMessage("en")).toMatch(/Settings/);
  });
});
