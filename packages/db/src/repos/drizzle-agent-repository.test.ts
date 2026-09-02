import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isEnvelope, openPayload, sealPayload } from "@agentforge/core";
import { ensureSchema } from "../ensure-schema";
import * as schema from "../schema";
import { agentVersions, agents, messages, organizations, threads, workspaces } from "../schema";
import { getLocalVaultKey } from "../vault-key";
import { DrizzleAgentRepository } from "./drizzle-agent-repository";

const SECRET = "phase3-seal-regression-key";
const SYSTEM_PROMPT = "You are a private desk agent. Never echo the owner's gateway key.";
const MESSAGE_TEXT = "Draft the meeting note with the private budget number 1842.";

function parseStored(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function expectEnvelopeWithoutPlaintext(stored: unknown, plaintext: string) {
  expect(isEnvelope(stored)).toBe(true);
  if (!isEnvelope(stored)) {
    return;
  }
  expect(stored.v).toBe(1);
  expect(stored.alg).toBe("aes-256-gcm");
  expect(typeof stored.n).toBe("string");
  expect(typeof stored.ct).toBe("string");
  expect(typeof stored.tag).toBe("string");
  const serialized = JSON.stringify(stored);
  expect(serialized).not.toContain(plaintext);
}

describe("DrizzleAgentRepository at-rest seal", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: DrizzleAgentRepository;
  let previousKey: string | undefined;
  const orgId = "org-seal";
  const workspaceId = "ws-seal";
  const agentId = "agent-seal";

  beforeEach(async () => {
    previousKey = process.env.AGENTFORGE_SECRETS_KEY;
    process.env.AGENTFORGE_SECRETS_KEY = SECRET;
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    ensureSchema(sqlite);
    db = drizzle(sqlite, { schema });
    repo = new DrizzleAgentRepository(db);
    const now = new Date();
    await db.insert(organizations).values({
      id: orgId,
      name: "Personal",
      slug: "personal-seal",
      industryPack: "generic",
      createdAt: now,
    });
    await db.insert(workspaces).values({
      id: workspaceId,
      organizationId: orgId,
      name: "Home",
      slug: "home",
      createdAt: now,
    });
    await db.insert(agents).values({
      id: agentId,
      organizationId: orgId,
      workspaceId,
      name: "Desk",
      slug: "desk",
      description: "",
      visibility: "private",
      createdByUserId: "user-seal",
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    sqlite.close();
    if (previousKey === undefined) {
      delete process.env.AGENTFORGE_SECRETS_KEY;
    } else {
      process.env.AGENTFORGE_SECRETS_KEY = previousKey;
    }
  });

  it("writes systemPrompt as a sealPayload envelope and opens it back", async () => {
    const versionId = "ver-seal";
    await repo.insertVersion({
      id: versionId,
      agentId,
      organizationId: orgId,
      version: 1,
      systemPrompt: SYSTEM_PROMPT,
      model: "gpt-4o-mini",
      inputModalities: ["text"],
      productModes: ["chat"],
      config: { imageGenModel: "flux-placeholder" },
      createdAt: new Date(),
    });

    const row = sqlite.prepare("SELECT system_prompt FROM agent_versions WHERE id = ?").get(versionId) as
      | { system_prompt: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.system_prompt).not.toContain(SYSTEM_PROMPT);
    expectEnvelopeWithoutPlaintext(parseStored(row!.system_prompt), SYSTEM_PROMPT);

    const opened = await repo.findVersionById(orgId, versionId);
    expect(opened?.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(opened?.model).toBe("gpt-4o-mini");
    expect(opened?.config).toEqual({ imageGenModel: "flux-placeholder" });
  });

  it("opens a legacy plaintext systemPrompt (backward-compat)", async () => {
    const versionId = "ver-plain";
    await db.insert(agentVersions).values({
      id: versionId,
      agentId,
      organizationId: orgId,
      version: 1,
      systemPrompt: SYSTEM_PROMPT,
      model: "gpt-4o-mini",
      inputModalities: ["text"],
      productModes: ["chat"],
      config: {},
      createdAt: new Date(),
    });

    const raw = sqlite.prepare("SELECT system_prompt FROM agent_versions WHERE id = ?").get(versionId) as {
      system_prompt: string;
    };
    expect(raw.system_prompt).toBe(SYSTEM_PROMPT);
    expect(isEnvelope(parseStored(raw.system_prompt))).toBe(false);

    const opened = await repo.findVersionById(orgId, versionId);
    expect(opened?.systemPrompt).toBe(SYSTEM_PROMPT);
  });

  it("writes message content as a sealPayload envelope (same contract as threads.insertMessage)", async () => {
    const threadId = "thread-seal";
    const messageId = "msg-seal";
    const content = [{ type: "text", text: MESSAGE_TEXT }];
    await db.insert(threads).values({
      id: threadId,
      organizationId: orgId,
      workspaceId,
      agentId,
      userId: "user-seal",
      title: "Budget note",
      createdAt: new Date(),
    });
    await db.insert(messages).values({
      id: messageId,
      organizationId: orgId,
      threadId,
      role: "user",
      content: sealPayload(content, getLocalVaultKey()),
      createdAt: new Date(),
    });

    const row = sqlite.prepare("SELECT content, title FROM messages JOIN threads ON threads.id = messages.thread_id WHERE messages.id = ?").get(
      messageId,
    ) as { content: string; title: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.title).toBe("Budget note");
    const stored = typeof row?.content === "string" ? parseStored(row.content) : row?.content;
    expectEnvelopeWithoutPlaintext(stored, MESSAGE_TEXT);
    expect(openPayload<typeof content>(stored, getLocalVaultKey())).toEqual(content);
  });
});
