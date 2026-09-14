import { describe, expect, it } from "vitest";
import { stubChatCopy, stubChatEnhanceSuffix, wantsStubClock, withChatOutputLanguage } from "./chat-locale";

describe("chat locale", () => {
  it("appends Bahasa output instructions only for id", () => {
    const base = "You are a helpful assistant.";
    expect(withChatOutputLanguage(base, "en")).toBe(base);
    const id = withChatOutputLanguage(base, "id");
    expect(id.startsWith(base)).toBe(true);
    expect(id).toMatch(/Bahasa Indonesia/);
    expect(withChatOutputLanguage(id, "id")).toBe(id);
  });

  it("keeps stub copy professional Indonesian", () => {
    const copy = stubChatCopy("id");
    expect(copy.needKey).toMatch(/Toko Token/);
    expect(copy.needKey).toMatch(/Pengaturan/);
    expect(copy.needKey).not.toMatch(/I need/);
    expect(stubChatEnhanceSuffix("id")).toMatch(/Anda/);
  });

  it("detects Indonesian clock questions", () => {
    expect(wantsStubClock("What time is it now?")).toBe(true);
    expect(wantsStubClock("Jam berapa sekarang?")).toBe(true);
    expect(wantsStubClock("Hari ini tanggal berapa?")).toBe(true);
    expect(wantsStubClock("What is 2 + 3?")).toBe(false);
  });
});
