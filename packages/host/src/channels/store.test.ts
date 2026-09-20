import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, type TenantContext } from "@agentforge/core";
import { CHANNEL_CAPS } from "@agentforge/core/channels";
import { createChannelStore, type ChannelStore, type CreateChannelInput } from "./store";

const tenant: TenantContext = { tenantId: "local-tenant", organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };
const otherDesk: TenantContext = { ...tenant, workspaceId: "ws-2" };

const INPUT: CreateChannelInput = {
  transport: "telegram",
  chatTarget: "@trading_floor",
  chatId: "-1001234567890",
  title: "Trading floor",
  chatType: "supergroup",
};

let root: string;
let store: ChannelStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agentforge-channels-"));
  store = createChannelStore(root);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("channel store", () => {
  it("creates a channel carrying both tenancy ids", () => {
    const channel = store.create(tenant, INPUT);
    expect(channel).toMatchObject({
      organizationId: "org",
      workspaceId: "ws-1",
      transport: "telegram",
      chatId: INPUT.chatId,
      lastSentAt: null,
      lastReceivedAt: null,
    });
    expect(store.list(tenant).map((row) => row.id)).toEqual([channel.id]);
  });

  it("keeps one desk's channels invisible to another, as missing rather than forbidden", () => {
    const channel = store.create(tenant, INPUT);
    expect(store.list(otherDesk)).toEqual([]);
    expect(store.get(otherDesk, channel.id)).toBeNull();
    expect(store.findByChatId(otherDesk, INPUT.chatId)).toBeNull();
    expect(store.remove(otherDesk, channel.id)).toBe(false);
    expect(store.messages(otherDesk, channel.id)).toEqual([]);
    expect(() => store.append(otherDesk, channel.id, [])).toThrow(ApiError);
    // …and the owning desk is untouched by any of it.
    expect(store.get(tenant, channel.id)).not.toBeNull();
  });

  it("refuses a second channel for the same chat, and caps how many a desk can hold", () => {
    store.create(tenant, INPUT);
    expect(() => store.create(tenant, INPUT)).toThrow(/already has that channel/);
    for (let n = 1; n < CHANNEL_CAPS.maxPerWorkspace; n += 1) {
      store.create(tenant, { ...INPUT, chatId: `-100${n}`, chatTarget: `-100${n}` });
    }
    expect(() => store.create(tenant, { ...INPUT, chatId: "-999", chatTarget: "-999" })).toThrow(
      new RegExp(`${CHANNEL_CAPS.maxPerWorkspace} channels`),
    );
  });

  it("files messages oldest first, skips ones already stored, and stamps the channel", () => {
    const channel = store.create(tenant, INPUT);
    const added = store.append(tenant, channel.id, [
      { direction: "in", externalId: "2", author: "@kyo", text: "second", at: 2_000 },
      { direction: "out", externalId: "1", author: "@bot", text: "first", at: 1_000 },
    ]);
    expect(added).toHaveLength(2);
    expect(store.messages(tenant, channel.id).map((row) => row.text)).toEqual(["first", "second"]);

    // A re-poll hands back the same inbound message: it must not land twice.
    const again = store.append(tenant, channel.id, [
      { direction: "in", externalId: "2", author: "@kyo", text: "second", at: 2_000 },
    ]);
    expect(again).toEqual([]);
    expect(store.messages(tenant, channel.id)).toHaveLength(2);

    const stamped = store.get(tenant, channel.id);
    expect(stamped).toMatchObject({ lastReceivedAt: 2_000, lastSentAt: 1_000 });
  });

  it("keeps only the newest messages once the cap is passed", () => {
    const channel = store.create(tenant, INPUT);
    const rows = Array.from({ length: CHANNEL_CAPS.maxStoredMessages + 10 }, (_, index) => ({
      direction: "in" as const,
      externalId: String(index),
      author: "@kyo",
      text: `line ${index}`,
      at: 1_000 + index,
    }));
    store.append(tenant, channel.id, rows);
    const stored = store.messages(tenant, channel.id);
    expect(stored).toHaveLength(CHANNEL_CAPS.maxStoredMessages);
    expect(stored.map((row) => row.text).at(0)).toBe("line 10");
    expect(stored.map((row) => row.text).at(-1)).toBe(`line ${CHANNEL_CAPS.maxStoredMessages + 9}`);
  });

  it("drops the stored conversation with the channel", () => {
    const channel = store.create(tenant, INPUT);
    store.append(tenant, channel.id, [{ direction: "in", externalId: "1", author: "@kyo", text: "hi", at: 1 }]);
    expect(store.remove(tenant, channel.id)).toBe(true);
    expect(store.get(tenant, channel.id)).toBeNull();
    expect(store.messages(tenant, channel.id)).toEqual([]);
  });

  it("round-trips the bot identity and the poll cursor, and forgets them on demand", () => {
    expect(store.readBot(tenant)).toBeNull();
    expect(store.readOffset(tenant)).toBeNull();
    store.writeBot(tenant, { id: "1", username: "desk_bot", name: "Desk", connectedAt: 10 });
    store.writeOffset(tenant, 4242);
    expect(store.readBot(tenant)).toMatchObject({ username: "desk_bot" });
    expect(store.readOffset(tenant)).toBe(4242);
    // Another desk shares neither.
    expect(store.readBot(otherDesk)).toBeNull();
    expect(store.readOffset(otherDesk)).toBeNull();
    store.clearBot(tenant);
    expect(store.readBot(tenant)).toBeNull();
  });

  it("drops everything a deleted desk stored", () => {
    const channel = store.create(tenant, INPUT);
    store.writeBot(tenant, { id: "1", username: "desk_bot", name: "Desk", connectedAt: 10 });
    store.append(tenant, channel.id, [{ direction: "in", externalId: "1", author: "@kyo", text: "hi", at: 1 }]);
    store.dropWorkspace("ws-1");
    expect(store.list(tenant)).toEqual([]);
    expect(store.readBot(tenant)).toBeNull();
  });

  it("treats a hand-edited or corrupt file as empty rather than throwing", () => {
    const deskDir = join(root, "ws-1");
    mkdirSync(deskDir, { recursive: true });
    writeFileSync(join(deskDir, "channels.json"), "{ not json", "utf8");
    expect(store.list(tenant)).toEqual([]);
    writeFileSync(join(deskDir, "channels.json"), JSON.stringify({ version: 1, channels: [{ id: "x" }] }), "utf8");
    expect(store.list(tenant)).toEqual([]);
  });

  it("refuses a path-traversal id instead of writing outside the desk", () => {
    expect(() => store.messages({ ...tenant, workspaceId: "../escape" }, "id")).toThrow(ApiError);
    const channel = store.create(tenant, INPUT);
    expect(store.get(tenant, "../../etc/passwd")).toBeNull();
    expect(() => store.append(tenant, "../../etc/passwd", [])).toThrow(ApiError);
    expect(store.get(tenant, channel.id)).not.toBeNull();
  });

  it("writes a channel file that is readable JSON, not a partial write", () => {
    const channel = store.create(tenant, INPUT);
    const parsed = JSON.parse(readFileSync(join(root, "ws-1", "channels.json"), "utf8")) as {
      version: number;
      channels: Array<{ id: string }>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.channels.map((row) => row.id)).toEqual([channel.id]);
  });
});
