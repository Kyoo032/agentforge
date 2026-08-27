import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "./settings-store";

const SECRET = "a".repeat(64);
const PLAIN_KEY = "sk-test-plaintext-should-not-appear";

describe("settings-store", () => {
  let dir: string;
  let previousPath: string | undefined;
  let previousKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-settings-"));
    previousPath = process.env.AGENTFORGE_SETTINGS_PATH;
    previousKey = process.env.AGENTFORGE_SECRETS_KEY;
    process.env.AGENTFORGE_SETTINGS_PATH = dir;
    process.env.AGENTFORGE_SECRETS_KEY = SECRET;
  });

  afterEach(() => {
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

  it("writes settings.enc that is not raw openaiApiKey plaintext", () => {
    const saved = saveSettings({ openaiApiKey: PLAIN_KEY });
    expect(saved.openaiApiKey).toBe(PLAIN_KEY);

    const encPath = join(dir, "settings.enc");
    expect(existsSync(encPath)).toBe(true);
    const raw = readFileSync(encPath, "utf8");
    expect(raw).not.toContain("openaiApiKey");
    expect(raw).not.toContain(PLAIN_KEY);
    expect(existsSync(join(dir, "settings.json"))).toBe(false);

    expect(loadSettings().openaiApiKey).toBe(PLAIN_KEY);
  });

  it("migrates legacy settings.json into settings.enc", () => {
    writeFileSync(join(dir, "settings.json"), `${JSON.stringify({ openaiApiKey: PLAIN_KEY })}\n`, "utf8");
    const loaded = loadSettings();
    expect(loaded.openaiApiKey).toBe(PLAIN_KEY);
    const raw = readFileSync(join(dir, "settings.enc"), "utf8");
    expect(raw).not.toContain(PLAIN_KEY);
    expect(raw).not.toContain("openaiApiKey");
    expect(existsSync(join(dir, "settings.json"))).toBe(false);
  });
});
