import { describe, expect, it } from "vitest";
import path from "node:path";
import { WEKNORA_BINARY_BASENAME, weknoraAvailable, weknoraBinaryDir, weknoraPlatformKey } from "./binary";

/**
 * Resolution has to be honest in both directions: a binary that is there must be found, and one
 * that is not must say *why*, because "unsupported platform" and "you forgot to stage it" lead the
 * owner to two completely different next steps.
 */

describe("weknora binary resolution", () => {
  it("uses AGENTFORGE_WEKNORA_PATH when it points at a real file", () => {
    // `process.execPath` is the one binary every machine running this test is guaranteed to have.
    const found = weknoraAvailable({ AGENTFORGE_WEKNORA_PATH: process.execPath });
    expect(found).toEqual({ available: true, path: process.execPath, reason: null });
  });

  it("reports env_path_missing rather than falling through to another binary", () => {
    const missing = path.join(path.dirname(process.execPath), "definitely-not-here.bin");
    const found = weknoraAvailable({ AGENTFORGE_WEKNORA_PATH: missing });
    expect(found.available).toBe(false);
    expect(found.path).toBeNull();
    expect(found.reason).toBe("env_path_missing");
  });

  it("ignores a blank override", () => {
    const found = weknoraAvailable({ AGENTFORGE_WEKNORA_PATH: "   " });
    // No binary is staged in the repo (the folder is gitignored), so this is the honest answer.
    expect(found.available).toBe(false);
    expect(["not_staged", "unsupported_platform"]).toContain(found.reason);
  });

  it("names the platform folder the staging script writes", () => {
    expect(weknoraPlatformKey("win32", "x64")).toBe("win32-x64");
    expect(weknoraPlatformKey("darwin", "arm64")).toBe("darwin-arm64");
  });

  it("spawns from the binary's own directory so migrations/sqlite resolves", () => {
    const binary = path.join("/opt", "weknora", "darwin-arm64", WEKNORA_BINARY_BASENAME);
    expect(weknoraBinaryDir(binary)).toBe(path.join("/opt", "weknora", "darwin-arm64"));
  });
});
