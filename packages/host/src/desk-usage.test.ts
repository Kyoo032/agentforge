import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_TENANT_ID } from "@agentforge/core";
import { appendDeskUsage, listDeskUsage } from "./desk-usage";

describe("desk-usage", () => {
  let dir: string;
  let previousDir: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentforge-desk-"));
    previousDir = process.env.AGENTFORGE_DATA_DIR;
    process.env.AGENTFORGE_DATA_DIR = dir;
  });

  afterEach(() => {
    if (previousDir === undefined) {
      delete process.env.AGENTFORGE_DATA_DIR;
    } else {
      process.env.AGENTFORGE_DATA_DIR = previousDir;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends token records and skips empty ones", () => {
    appendDeskUsage(LOCAL_TENANT_ID, { model: "gpt-5.6-sol", inputTokens: 10, outputTokens: 4 });
    appendDeskUsage(LOCAL_TENANT_ID, { model: "skip-me", inputTokens: 0, outputTokens: 0 });
    expect(listDeskUsage(LOCAL_TENANT_ID)).toEqual([{ model: "gpt-5.6-sol", inputTokens: 10, outputTokens: 4 }]);
    const raw = readFileSync(join(dir, "desk-usage.json"), "utf8");
    expect(raw).toMatch(/"at":"/);
    expect(raw).not.toMatch(/sk-/);
    expect(raw).not.toMatch(/systemPrompt/);
  });
});
