import { describe, expect, it } from "vitest";
import { APP_LOCALES, DEFAULT_APP_LOCALE, isAppLocale, parseAppLocale } from "./locale";

describe("parseAppLocale", () => {
  it("accepts en and id only", () => {
    expect(APP_LOCALES).toEqual(["en", "id"]);
    expect(DEFAULT_APP_LOCALE).toBe("en");
    expect(isAppLocale("en")).toBe(true);
    expect(isAppLocale("id")).toBe(true);
    expect(isAppLocale("ID")).toBe(false);
    expect(isAppLocale("fr")).toBe(false);
    expect(parseAppLocale("id")).toBe("id");
    expect(parseAppLocale("en")).toBe("en");
    expect(parseAppLocale(undefined)).toBe("en");
    expect(parseAppLocale("de")).toBe("en");
  });
});
