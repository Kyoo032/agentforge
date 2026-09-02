import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATEWAY_BASE_URL } from "@agentforge/core";
import { loadSettings, saveSettings } from "./settings-store";

const SECRET = "a".repeat(64);

describe("settings-store gateway lock", () => {
  let dir: string;
  let previousPath: string | undefined;
  let previousKey: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-host-settings-"));
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

  it("always stores the Toko Token gateway URL", () => {
    const saved = saveSettings({
      openaiApiKey: "sk-test",
      openaiBaseUrl: "https://example.invalid/v1",
    });
    expect(saved.openaiBaseUrl).toBe(GATEWAY_BASE_URL);
    expect(loadSettings().openaiBaseUrl).toBe(GATEWAY_BASE_URL);
  });
});
