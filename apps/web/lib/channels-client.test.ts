import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelError,
  NOT_CONNECTED_CODE,
  addChannel,
  connectTelegramBot,
  loadChannelMessages,
  loadChannels,
  pollTelegram,
  sendToChannel,
} from "./channels-client";

type Call = { input: string; init: RequestInit };

function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

function lastCall(calls: Call[]): Call {
  const call = calls.at(-1);
  if (!call) {
    throw new Error("no fetch call was made");
  }
  return call;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("channels client", () => {
  it("reads the desk's channels and bot status", async () => {
    stubFetch(200, { channels: [{ id: "c1", title: "Trading floor" }], bot: { connected: true } });
    await expect(loadChannels()).resolves.toMatchObject({
      bot: { connected: true },
      channels: [{ id: "c1" }],
    });
  });

  it("posts the token as JSON and never puts it in the URL", async () => {
    const calls = stubFetch(200, { connected: true, username: "desk_bot" });
    await connectTelegramBot("123456789:AAtokenvaluegoeshere0000000000000000");
    const call = lastCall(calls);
    expect(call.input).toBe("/api/v1/channels/telegram/bot");
    expect(call.input).not.toContain("123456789");
    expect(String(call.init.body)).toContain("123456789");
    expect(call.init.method).toBe("POST");
  });

  it("surfaces the host's error code so the page can say 'connect a bot first'", async () => {
    stubFetch(409, { error: { code: NOT_CONNECTED_CODE, message: "Connect a Telegram bot for this desk first" } });
    const failure = await addChannel("@trading_floor").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChannelError);
    expect((failure as ChannelError).code).toBe(NOT_CONNECTED_CODE);
  });

  it("keeps Telegram's own message when the host relays one", async () => {
    stubFetch(400, { error: { code: "channel_error", message: "Telegram refused the call: chat not found" } });
    await expect(sendToChannel("c1", "hello")).rejects.toThrow(/chat not found/);
  });

  it("escapes the channel id it puts in a path", async () => {
    const calls = stubFetch(200, { messages: [] });
    await loadChannelMessages("a/b?c");
    expect(lastCall(calls).input).toBe("/api/v1/channels/a%2Fb%3Fc/messages");
  });

  it("returns the poll counts the page reports", async () => {
    stubFetch(200, { received: 2, unmatched: 1, channels: [{ channelId: "c1", added: 2 }] });
    await expect(pollTelegram()).resolves.toMatchObject({ received: 2, unmatched: 1 });
  });
});
