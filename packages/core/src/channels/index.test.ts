import { describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { CHANNEL_CAPS, assertSendableText, channelDisplayText, parseChatTarget } from "./index";
import { PINNED_TELEGRAM_API_ORIGIN, resolvedTelegramApiOrigin } from "./pinned";

describe("parseChatTarget", () => {
  it("takes a numeric chat id, including the negative supergroup form", () => {
    expect(parseChatTarget("123456")).toEqual({ kind: "id", value: "123456" });
    expect(parseChatTarget(" -1001234567890 ")).toEqual({ kind: "id", value: "-1001234567890" });
  });

  it("takes an @username, and adds the @ when the owner left it off", () => {
    expect(parseChatTarget("@dpsbuddy_desk")).toEqual({ kind: "username", value: "@dpsbuddy_desk" });
    expect(parseChatTarget("dpsbuddy_desk")).toEqual({ kind: "username", value: "@dpsbuddy_desk" });
  });

  it("refuses anything that is not one of those two shapes", () => {
    for (const bad of [
      "",
      "   ",
      "@ab",
      "@1startsWithADigit",
      "has space",
      "https://t.me/dpsbuddy",
      "@name/../../etc",
      "12345678901234567890123",
      null,
      42,
    ]) {
      expect(() => parseChatTarget(bad)).toThrow(ApiError);
    }
  });
});

describe("assertSendableText", () => {
  it("trims and returns the text", () => {
    expect(assertSendableText("  hello desk  ")).toBe("hello desk");
  });

  it("refuses empty text and text over the Bot API limit", () => {
    expect(() => assertSendableText("   ")).toThrow(ApiError);
    expect(() => assertSendableText(undefined)).toThrow(ApiError);
    expect(() => assertSendableText("x".repeat(CHANNEL_CAPS.maxTextChars + 1))).toThrow(ApiError);
    expect(assertSendableText("x".repeat(CHANNEL_CAPS.maxTextChars))).toHaveLength(CHANNEL_CAPS.maxTextChars);
  });
});

describe("channelDisplayText", () => {
  it("collapses whitespace, caps the length, and falls back when there is nothing", () => {
    expect(channelDisplayText("  Trading   floor \n desk ", "Channel")).toBe("Trading floor desk");
    expect(channelDisplayText("", "Channel")).toBe("Channel");
    expect(channelDisplayText(null, "Channel")).toBe("Channel");
    expect(channelDisplayText("y".repeat(500), "Channel")).toHaveLength(CHANNEL_CAPS.maxNameChars);
  });
});

describe("resolvedTelegramApiOrigin", () => {
  it("is the pinned origin when nothing overrides it", () => {
    expect(resolvedTelegramApiOrigin({})).toBe(PINNED_TELEGRAM_API_ORIGIN);
  });

  it("honours the dev hook, without a trailing slash", () => {
    expect(resolvedTelegramApiOrigin({ AGENTFORGE_TELEGRAM_API_URL: "http://127.0.0.1:3399/" })).toBe(
      "http://127.0.0.1:3399",
    );
  });

  it("ignores a malformed or non-http override rather than throwing", () => {
    expect(resolvedTelegramApiOrigin({ AGENTFORGE_TELEGRAM_API_URL: "not a url" })).toBe(
      PINNED_TELEGRAM_API_ORIGIN,
    );
    expect(resolvedTelegramApiOrigin({ AGENTFORGE_TELEGRAM_API_URL: "file:///etc/passwd" })).toBe(
      PINNED_TELEGRAM_API_ORIGIN,
    );
  });

  it("stays pinned inside a packaged build whatever the env says", () => {
    const previous = process.env.AGENTFORGE_PACKAGED;
    process.env.AGENTFORGE_PACKAGED = "1";
    try {
      expect(resolvedTelegramApiOrigin({ AGENTFORGE_TELEGRAM_API_URL: "http://127.0.0.1:3399" })).toBe(
        PINNED_TELEGRAM_API_ORIGIN,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.AGENTFORGE_PACKAGED;
      } else {
        process.env.AGENTFORGE_PACKAGED = previous;
      }
    }
  });
});
