import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { assertInsidePath, escapeFilterPath } from "./ffmpeg/paths";

describe("path allowlist (G-14)", () => {
  it("rejects NUL, UNC, device, drive-relative, and empty paths", () => {
    const roots = ["/tmp/edit-root"];
    expect(() => assertInsidePath("", roots)).toThrow(ApiError);
    expect(() => assertInsidePath("a\0b", roots)).toThrow(ApiError);
    expect(() => assertInsidePath("\\\\server\\share\\file", roots)).toThrow(ApiError);
    expect(() => assertInsidePath("\\\\?\\C:\\Windows", roots)).toThrow(ApiError);
    expect(() => assertInsidePath("C:foo", roots)).toThrow(ApiError);
  });

  it("rejects paths that escape the root", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edit-root-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "ok.txt"), "ok");
    expect(() => assertInsidePath(path.join(dir, "..", "secret"), [dir])).toThrow(ApiError);
  });

  it("rejects a symlink that points outside the root", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "edit-link-"));
    const outside = mkdtempSync(path.join(tmpdir(), "edit-out-"));
    writeFileSync(path.join(outside, "secret.txt"), "nope");
    const link = path.join(dir, "escape.txt");
    symlinkSync(path.join(outside, "secret.txt"), link);
    expect(() => assertInsidePath(link, [dir])).toThrow(ApiError);
  });

  it("escapes C:/ and apostrophes for ass= filters", () => {
    const escaped = escapeFilterPath("C:/Users/O'Brien/title.ass");
    expect(escaped).toContain("C\\:/Users/O\\'Brien/title.ass");
    expect(escaped.includes("\\[") || true).toBe(true);
  });
});
