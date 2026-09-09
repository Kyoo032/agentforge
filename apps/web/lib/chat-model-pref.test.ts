import { describe, expect, it } from "vitest";
import {
  pickChatModel,
  readLastChatModel,
  readThreadChatModel,
  writeLastChatModel,
  writeThreadChatModel,
} from "./chat-model-pref";

function memoryStore(initial: Record<string, string> = {}): Storage {
  const data = { ...initial };
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear() {
      for (const key of Object.keys(data)) {
        delete data[key];
      }
    },
    getItem(key: string) {
      return key in data ? data[key] : null;
    },
    key() {
      return null;
    },
    removeItem(key: string) {
      delete data[key];
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
  };
}

const models = [{ id: "claude-sonnet-5" }, { id: "gpt-5.6-sol" }, { id: "kimi-k3" }];

describe("pickChatModel", () => {
  it("restores the thread's last model when switching sessions", () => {
    expect(
      pickChatModel({
        models,
        current: "claude-sonnet-5",
        threadModel: "kimi-k3",
        lastModel: "gpt-5.6-sol",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("kimi-k3");
  });

  it("keeps the current picker when the destination thread has no memory", () => {
    expect(
      pickChatModel({
        models,
        current: "gpt-5.6-sol",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("gpt-5.6-sol");
    expect(
      pickChatModel({
        models,
        current: "kimi-k3",
        threadModel: "",
        lastModel: "gpt-5.6-sol",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("kimi-k3");
  });

  it("does not snap back to the catalog default while a valid current model is set", () => {
    expect(
      pickChatModel({
        models,
        current: "kimi-k3",
        lastModel: "gpt-5.6-sol",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("kimi-k3");
  });

  it("falls through to current when the thread model left the catalog", () => {
    expect(
      pickChatModel({
        models,
        current: "gpt-5.6-sol",
        threadModel: "retired",
        lastModel: "kimi-k3",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("gpt-5.6-sol");
  });

  it("uses last-used, then catalog default, then the first catalog id", () => {
    expect(
      pickChatModel({
        models,
        lastModel: "gpt-5.6-sol",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("gpt-5.6-sol");
    expect(pickChatModel({ models, catalogDefault: "claude-sonnet-5" })).toBe("claude-sonnet-5");
    expect(pickChatModel({ models: [] })).toBe("");
  });

  it("ignores stale ids that left the catalog", () => {
    expect(
      pickChatModel({
        models,
        current: "retired",
        threadModel: "also-retired",
        lastModel: "gone",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("claude-sonnet-5");
  });

  it("uses catalog default only when current, last, and thread are empty or stale", () => {
    expect(
      pickChatModel({
        models,
        current: "",
        threadModel: "retired",
        lastModel: "gone",
        catalogDefault: "claude-sonnet-5",
      }),
    ).toBe("claude-sonnet-5");
  });
});

describe("chat model memory", () => {
  it("round-trips last-used and per-thread models", () => {
    const storage = memoryStore();
    writeLastChatModel("kimi-k3", storage);
    writeThreadChatModel("thread-a", "gpt-5.6-sol", storage);
    writeThreadChatModel("thread-b", "kimi-k3", storage);
    expect(readLastChatModel(storage)).toBe("kimi-k3");
    expect(readThreadChatModel("thread-a", storage)).toBe("gpt-5.6-sol");
    expect(readThreadChatModel("thread-b", storage)).toBe("kimi-k3");
    expect(readThreadChatModel("thread-missing", storage)).toBe("");
  });

  it("overwrites a thread's stored model and ignores empty writes", () => {
    const storage = memoryStore();
    writeThreadChatModel("thread-a", "gpt-5.6-sol", storage);
    writeThreadChatModel("thread-a", "kimi-k3", storage);
    writeThreadChatModel("", "claude-sonnet-5", storage);
    writeThreadChatModel("thread-a", "  ", storage);
    writeLastChatModel("", storage);
    expect(readThreadChatModel("thread-a", storage)).toBe("kimi-k3");
    expect(readLastChatModel(storage)).toBe("");
  });

  it("returns empty when thread storage is missing or not a map", () => {
    const storage = memoryStore({ "agentforge-chat-thread-models": "[1]" });
    expect(readThreadChatModel("thread-a", storage)).toBe("");
    storage.setItem("agentforge-chat-thread-models", "{not-json");
    expect(readThreadChatModel("thread-a", storage)).toBe("");
  });
});
