import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("defaults to light when nothing is stored", () => {
    expect(resolveTheme(null)).toBe("light");
  });

  it("keeps an explicit dark choice", () => {
    expect(resolveTheme("dark")).toBe("dark");
  });
});
