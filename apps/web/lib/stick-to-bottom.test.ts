import { describe, expect, it } from "vitest";
import { isPinnedToEnd } from "@/lib/stick-to-bottom";

describe("isPinnedToEnd", () => {
  it("follows when the pane is already at the end", () => {
    expect(isPinnedToEnd(400, 1000, 600)).toBe(true);
  });

  it("follows within a few pixels of the end", () => {
    expect(isPinnedToEnd(340, 1000, 600)).toBe(true);
  });

  it("lets go once the reader has moved up", () => {
    expect(isPinnedToEnd(200, 1000, 600)).toBe(false);
  });

  it("follows an empty pane", () => {
    expect(isPinnedToEnd(0, 400, 600)).toBe(true);
  });
});
