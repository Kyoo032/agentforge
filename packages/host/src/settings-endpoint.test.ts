import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATEWAY_BASE_URL, resolvedGatewayBaseUrl } from "@agentforge/core";
import { loadSettings, saveSettings } from "./settings-store";

const SECRET = "a".repeat(64);
const CUSTOM_ENDPOINT = "https://gateway.example.test/v1";

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

describe("settings-store gateway endpoint", () => {
  let dir: string;
  let previousPath: string | undefined;
  let previousKey: string | undefined;
  let previousGateway: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "af-host-settings-"));
    previousPath = process.env.AGENTFORGE_SETTINGS_PATH;
    previousKey = process.env.AGENTFORGE_SECRETS_KEY;
    previousGateway = process.env.AGENTFORGE_GATEWAY_URL;
    process.env.AGENTFORGE_SETTINGS_PATH = dir;
    process.env.AGENTFORGE_SECRETS_KEY = SECRET;
    delete process.env.AGENTFORGE_GATEWAY_URL;
  });

  afterEach(() => {
    restoreEnv("AGENTFORGE_SETTINGS_PATH", previousPath);
    restoreEnv("AGENTFORGE_SECRETS_KEY", previousKey);
    restoreEnv("AGENTFORGE_GATEWAY_URL", previousGateway);
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to the Toko Token gateway when nothing is saved", () => {
    expect(loadSettings().openaiBaseUrl).toBe(GATEWAY_BASE_URL);
    const saved = saveSettings({ openaiApiKey: "sk-test" });
    expect(saved.openaiBaseUrl).toBe(GATEWAY_BASE_URL);
    expect(loadSettings().openaiBaseUrl).toBe(GATEWAY_BASE_URL);
  });

  it("stores a custom HTTPS endpoint from Settings and keeps it across reloads", () => {
    const saved = saveSettings({ openaiApiKey: "sk-test", openaiBaseUrl: `${CUSTOM_ENDPOINT}/` });
    expect(saved.openaiBaseUrl).toBe(CUSTOM_ENDPOINT);
    expect(loadSettings().openaiBaseUrl).toBe(CUSTOM_ENDPOINT);
    // A later save that omits the field must not reset it.
    expect(saveSettings({ editTurnCapUsd: 3 }).openaiBaseUrl).toBe(CUSTOM_ENDPOINT);
  });

  it("resets to the gateway default when the endpoint is cleared", () => {
    saveSettings({ openaiBaseUrl: CUSTOM_ENDPOINT });
    const saved = saveSettings({ openaiBaseUrl: "   " });
    expect(saved.openaiBaseUrl).toBe(GATEWAY_BASE_URL);
    expect(loadSettings().openaiBaseUrl).toBe(GATEWAY_BASE_URL);
  });

  it("allows plain HTTP only for loopback (local model servers)", () => {
    expect(saveSettings({ openaiBaseUrl: "http://127.0.0.1:11434/v1" }).openaiBaseUrl).toBe(
      "http://127.0.0.1:11434/v1",
    );
  });

  it("rejects a remote plain-HTTP endpoint and keeps the previous value", () => {
    saveSettings({ openaiBaseUrl: CUSTOM_ENDPOINT });
    expect(() => saveSettings({ openaiBaseUrl: "http://gateway.example.test/v1" })).toThrowError(/HTTPS/);
    expect(loadSettings().openaiBaseUrl).toBe(CUSTOM_ENDPOINT);
  });

  it("rejects an endpoint that is not a URL", () => {
    expect(() => saveSettings({ openaiBaseUrl: "not a url" })).toThrowError(/not valid/);
  });

  it("defaults branded flavors to their own gateway URL", () => {
    process.env.AGENTFORGE_GATEWAY_URL = "https://aihub.metranet.co.id/v1";
    expect(resolvedGatewayBaseUrl()).toBe("https://aihub.metranet.co.id/v1");
    const saved = saveSettings({ openaiApiKey: "sk-test" });
    expect(saved.openaiBaseUrl).toBe("https://aihub.metranet.co.id/v1");
    expect(loadSettings().openaiBaseUrl).toBe("https://aihub.metranet.co.id/v1");
  });
});
