/**
 * Data mode's size label. Its own copy stopped at MB, so a gigabyte read "1024.0 MB"; it now
 * re-exports the one implementation in core that the Settings storage card also uses.
 */
import { describe, expect, it } from "vitest";
import { formatBytes as coreFormatBytes } from "@agentforge/core/format-bytes";
import { formatBytes } from "./data-client";

describe("data-client formatBytes", () => {
  it("is the core implementation, not a copy", () => {
    expect(formatBytes).toBe(coreFormatBytes);
  });

  it("renders a gigabyte as GB instead of capping at MB", () => {
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    // Below a gigabyte the labels Data mode already showed are unchanged.
    expect(formatBytes(25 * 1024 * 1024)).toBe("25.0 MB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(512)).toBe("512 B");
  });
});
