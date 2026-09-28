import { describe, expect, it } from "vitest";
import {
  chatTurnCopy,
  stubChatCopy,
  stubChatEnhanceSuffix,
  wantsStubClock,
  wantsStubDeskSource,
  wantsStubPastChat,
  withChatOutputLanguage,
} from "./chat-locale";

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

  it("notices an earlier chat and a desk-note question without a method", () => {
    expect(wantsStubPastChat("what did we decide last time")).toBe(true);
    expect(wantsStubPastChat("yang kita putuskan terakhir kali")).toBe(true);
    expect(wantsStubPastChat("What is 2 + 3?")).toBe(false);
    expect(wantsStubDeskSource("what does the desk say about the note")).toBe(true);
    expect(wantsStubDeskSource("menurut catatan itu")).toBe(true);
    expect(chatTurnCopy("id").noSource).toMatch(/Meja ini/);
    expect(chatTurnCopy("id").lookingAttached).toMatch(/Anda/);
  });
});
