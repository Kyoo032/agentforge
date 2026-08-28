import { describe, expect, it } from "vitest";
import type { TenantContext } from "../tenancy/types";
import { MemoryAgentRepository } from "./memory-repo";
import { AgentService, resolvePublishedVersion } from "./service";
import { ApiError } from "../errors";
import { DEFAULT_CHAT_MODEL } from "./default-chat";

function tenant(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    organizationId: "org-a",
    workspaceId: "ws-a",
    userId: "user-a",
    role: "builder",
    ...overrides,
  };
}

describe("AgentService tenancy", () => {
  it("does not let org B read org A agents", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const created = await service.create(tenant(), {
      name: "Tutor",
      systemPrompt: "Help with coursework",
      model: "gpt-4o-mini",
    });
    const other = tenant({ organizationId: "org-b", workspaceId: "ws-b", userId: "user-b" });
    expect(await service.get(other, created.agent.id)).toBeNull();
    expect(await service.get(tenant(), created.agent.id)).not.toBeNull();
  });

  it("rejects a model that is not in the catalog", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    try {
      await service.create(tenant(), {
        name: "Tutor",
        systemPrompt: "Help",
        model: "not-a-model",
      });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("unknown_model");
    }
  });
});

describe("ensureDefaultChat", () => {
  it("provisions a published personal chat agent with starter tools", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const created = await service.ensureDefaultChat(tenant({ role: "member" }));
    expect(created.agent.slug).toBe("quick-chat");
    expect(created.agent.visibility).toBe("private");
    expect(created.agent.currentVersionId).toBe(created.version.id);
    expect(created.version.inputModalities).toEqual(["text", "image", "video"]);
    expect(created.version.productModes).toEqual(["chat"]);
    expect(created.version.model).toBe(DEFAULT_CHAT_MODEL);
    expect(created.bindings.map((binding) => binding.toolKey).sort()).toEqual([
      "calculator",
      "datetime",
      "image_generate",
      "past_sessions",
      "video_generate",
      "web_search",
    ]);
  });

  it("adds new starter tools onto an existing default chat", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const created = await service.ensureDefaultChat(tenant({ role: "member" }));
    repo.bindings = repo.bindings.filter(
      (binding) => binding.toolKey !== "image_generate" && binding.toolKey !== "video_generate",
    );
    const again = await service.ensureDefaultChat(tenant({ role: "member" }));
    expect(again.agent.id).toBe(created.agent.id);
    expect(again.bindings.map((binding) => binding.toolKey).sort()).toEqual([
      "calculator",
      "datetime",
      "image_generate",
      "past_sessions",
      "video_generate",
      "web_search",
    ]);
  });

  it("returns the same agent on a second call", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const first = await service.ensureDefaultChat(tenant());
    const second = await service.ensureDefaultChat(tenant());
    expect(second.agent.id).toBe(first.agent.id);
    expect(repo.agents).toHaveLength(1);
  });

  it("gives each user their own default chat", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const alex = await service.ensureDefaultChat(tenant({ userId: "alex" }));
    const jordan = await service.ensureDefaultChat(tenant({ userId: "jordan" }));
    expect(alex.agent.id).not.toBe(jordan.agent.id);
  });
});

describe("resolvePublishedVersion", () => {
  it("uses the published version, not a later draft", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const created = await service.create(tenant(), {
      name: "Tutor",
      systemPrompt: "v1 prompt",
      model: "gpt-4o-mini",
    });
    await service.publish(tenant(), created.agent.id, created.version.id);
    const publishedAgent = await service.get(tenant(), created.agent.id);
    repo.versions.push({
      ...created.version,
      id: "draft-v2",
      version: 2,
      systemPrompt: "draft prompt should not run",
    });
    const published = resolvePublishedVersion(publishedAgent!, repo.versions);
    expect(published.id).toBe(created.version.id);
    expect(published.systemPrompt).toBe("v1 prompt");
  });
});

describe("productModes", () => {
  it("defaults a new agent to Chat and persists an explicit list", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const created = await service.create(tenant(), {
      name: "Tutor",
      systemPrompt: "Help",
      model: "gpt-4o-mini",
    });
    expect(created.version.productModes).toEqual(["chat"]);

    const marketing = await service.create(tenant(), {
      name: "Campaign",
      systemPrompt: "Ads",
      model: "gpt-4o-mini",
      productModes: ["images", "videos"],
    });
    await service.publish(tenant(), marketing.agent.id, marketing.version.id);
    expect(await service.listVisibleProductModes(tenant())).toEqual(["images", "videos"]);
  });

  it("updates published product modes", async () => {
    const repo = new MemoryAgentRepository();
    const service = new AgentService(repo);
    const created = await service.create(tenant(), {
      name: "Desk",
      systemPrompt: "Help",
      model: "gpt-4o-mini",
      productModes: ["chat"],
    });
    await service.publish(tenant(), created.agent.id, created.version.id);
    const updated = await service.updateProductModes(tenant(), created.agent.id, ["documents", "research"]);
    expect(updated.productModes).toEqual(["documents", "research"]);
    expect(await service.listVisibleProductModes(tenant())).toEqual(["documents", "research"]);
  });
});
