import { ApiError } from "../errors";
import type { InputModality, TenantContext, Visibility } from "../tenancy/types";
import { canAdminister, canBuild } from "../tenancy/types";
import {
  DEFAULT_CHAT_DESCRIPTION,
  DEFAULT_CHAT_MODALITIES,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_NAME,
  DEFAULT_CHAT_PROMPT,
  DEFAULT_CHAT_SLUG,
  DEFAULT_CHAT_TOOLS,
  isDefaultChatAgent,
} from "./default-chat";
import { getChatModel, listChatModels, type ChatModel } from "../models/catalog";
import { requireProductModes, resolveProductModes, type ProductMode } from "./product-modes";
import { mergeGeneratePins } from "./generate-defaults";

export type AgentRecord = {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  visibility: Visibility;
  createdByUserId: string;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AgentVersionRecord = {
  id: string;
  agentId: string;
  organizationId: string;
  version: number;
  systemPrompt: string;
  model: string;
  inputModalities: InputModality[];
  productModes?: ProductMode[] | null;
  config: Record<string, unknown>;
  createdAt: Date;
};

export type ToolBindingRecord = {
  id: string;
  agentVersionId: string;
  organizationId: string;
  toolKey: string;
  config: Record<string, unknown>;
  enabled: boolean;
};

export type CreateAgentInput = {
  name: string;
  description?: string;
  systemPrompt: string;
  model: string;
  inputModalities?: InputModality[];
  productModes?: ProductMode[];
  visibility?: Visibility;
  config?: Record<string, unknown>;
};

export type CreateRevisionInput = {
  systemPrompt?: string;
  model?: string;
  inputModalities?: InputModality[];
  toolKeys?: string[];
};

export interface AgentRepository {
  insertAgent(agent: AgentRecord): Promise<void>;
  insertVersion(version: AgentVersionRecord): Promise<void>;
  insertBinding(binding: ToolBindingRecord): Promise<void>;
  findAgentById(organizationId: string, agentId: string): Promise<AgentRecord | null>;
  listAgents(organizationId: string, workspaceId: string): Promise<AgentRecord[]>;
  findVersionById(organizationId: string, versionId: string): Promise<AgentVersionRecord | null>;
  listVersions(organizationId: string, agentId: string): Promise<AgentVersionRecord[]>;
  listBindings(organizationId: string, agentVersionId: string): Promise<ToolBindingRecord[]>;
  updateAgent(organizationId: string, agentId: string, patch: Partial<AgentRecord>): Promise<void>;
  updateVersion(
    organizationId: string,
    versionId: string,
    patch: Partial<Pick<AgentVersionRecord, "productModes" | "config">>,
  ): Promise<void>;
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.length > 0 ? slug : "agent";
}

function ensureModalities(input?: InputModality[]): InputModality[] {
  const modalities = input && input.length > 0 ? input : (["text"] as InputModality[]);
  if (!modalities.includes("text")) {
    return ["text", ...modalities];
  }
  return [...new Set(modalities)];
}

function canView(agent: AgentRecord, tenant: TenantContext): boolean {
  if (agent.organizationId !== tenant.organizationId) {
    return false;
  }
  if (agent.workspaceId !== tenant.workspaceId) {
    return false;
  }
  if (agent.visibility === "workspace") {
    return true;
  }
  if (agent.createdByUserId === tenant.userId) {
    return true;
  }
  return canAdminister(tenant.role);
}

export function resolvePublishedVersion(
  agent: AgentRecord,
  versions: AgentVersionRecord[],
): AgentVersionRecord {
  if (!agent.currentVersionId) {
    throw new ApiError("unpublished_agent", "Agent has no published version", 400);
  }
  const published = versions.find((version) => version.id === agent.currentVersionId);
  if (!published) {
    throw new ApiError("unpublished_agent", "Published version was not found", 400);
  }
  return published;
}

export class AgentService {
  constructor(
    private readonly repo: AgentRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  async create(
    tenant: TenantContext,
    input: CreateAgentInput,
    knownModels: ChatModel[] = listChatModels(),
  ): Promise<{ agent: AgentRecord; version: AgentVersionRecord }> {
    if (!canBuild(tenant.role)) {
      throw new ApiError("forbidden", "Builder role required", 403);
    }
    if (!getChatModel(input.model, knownModels)) {
      throw new ApiError("unknown_model", `Model '${input.model}' is not available`, 400);
    }
    const timestamp = this.now();
    const agentId = this.id();
    const versionId = this.id();
    const agent: AgentRecord = {
      id: agentId,
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      name: input.name,
      slug: slugify(input.name),
      description: input.description ?? "",
      visibility: input.visibility ?? "private",
      createdByUserId: tenant.userId,
      currentVersionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const version: AgentVersionRecord = {
      id: versionId,
      agentId,
      organizationId: tenant.organizationId,
      version: 1,
      systemPrompt: input.systemPrompt,
      model: input.model,
      inputModalities: ensureModalities(input.inputModalities),
      productModes: requireProductModes(input.productModes),
      config: input.config ?? {},
      createdAt: timestamp,
    };
    await this.repo.insertAgent(agent);
    await this.repo.insertVersion(version);
    return { agent, version };
  }

  async listVisibleProductModes(tenant: TenantContext): Promise<ProductMode[]> {
    const agents = await this.list(tenant);
    const sources: Array<{ slug: string; productModes?: ProductMode[] | null }> = [];
    for (const agent of agents) {
      if (isDefaultChatAgent(agent) || !agent.currentVersionId) {
        continue;
      }
      const version = await this.repo.findVersionById(tenant.organizationId, agent.currentVersionId);
      sources.push({ slug: agent.slug, productModes: version?.productModes ?? null });
    }
    return resolveProductModes(sources);
  }

  async listGenerateDefaultSources(tenant: TenantContext): Promise<
    Array<{
      slug: string;
      createdAt: Date;
      productModes?: ProductMode[] | null;
      config?: Record<string, unknown> | null;
    }>
  > {
    const agents = await this.list(tenant);
    const sources: Array<{
      slug: string;
      createdAt: Date;
      productModes?: ProductMode[] | null;
      config?: Record<string, unknown> | null;
    }> = [];
    for (const agent of agents) {
      if (!agent.currentVersionId) {
        continue;
      }
      const version = await this.repo.findVersionById(tenant.organizationId, agent.currentVersionId);
      sources.push({
        slug: agent.slug,
        createdAt: agent.createdAt,
        productModes: version?.productModes ?? null,
        config: version?.config ?? {},
      });
    }
    return sources;
  }

  async updateProductModes(
    tenant: TenantContext,
    agentId: string,
    productModes: unknown,
  ): Promise<AgentVersionRecord> {
    const agent = await this.requireOwned(tenant, agentId);
    if (!agent.currentVersionId) {
      throw new ApiError("unpublished_agent", "Agent has no published version", 400);
    }
    const version = await this.repo.findVersionById(tenant.organizationId, agent.currentVersionId);
    if (!version || version.agentId !== agent.id) {
      throw new ApiError("not_found", "Version not found", 404);
    }
    const next = requireProductModes(productModes);
    const updated: AgentVersionRecord = { ...version, productModes: next };
    await this.repo.updateVersion(tenant.organizationId, version.id, { productModes: next });
    return updated;
  }

  async updateGenerateDefaults(
    tenant: TenantContext,
    agentId: string,
    patch: { imageGenModel?: string | null; videoGenModel?: string | null; musicGenModel?: string | null },
  ): Promise<AgentVersionRecord> {
    const agent = await this.requireOwned(tenant, agentId);
    if (!agent.currentVersionId) {
      throw new ApiError("unpublished_agent", "Agent has no published version", 400);
    }
    const version = await this.repo.findVersionById(tenant.organizationId, agent.currentVersionId);
    if (!version || version.agentId !== agent.id) {
      throw new ApiError("not_found", "Version not found", 404);
    }
    const config = mergeGeneratePins(version.config, patch);
    const updated: AgentVersionRecord = { ...version, config };
    await this.repo.updateVersion(tenant.organizationId, version.id, { config });
    return updated;
  }

  async get(tenant: TenantContext, agentId: string): Promise<AgentRecord | null> {
    const agent = await this.repo.findAgentById(tenant.organizationId, agentId);
    if (!agent || !canView(agent, tenant)) {
      return null;
    }
    return agent;
  }

  async list(tenant: TenantContext): Promise<AgentRecord[]> {
    const agents = await this.repo.listAgents(tenant.organizationId, tenant.workspaceId);
    return agents.filter((agent) => canView(agent, tenant));
  }

  async publish(tenant: TenantContext, agentId: string, versionId: string): Promise<AgentRecord> {
    const agent = await this.requireOwned(tenant, agentId);
    const version = await this.repo.findVersionById(tenant.organizationId, versionId);
    if (!version || version.agentId !== agent.id) {
      throw new ApiError("not_found", "Version not found", 404);
    }
    const updated = { ...agent, currentVersionId: versionId, updatedAt: this.now() };
    await this.repo.updateAgent(tenant.organizationId, agentId, {
      currentVersionId: versionId,
      updatedAt: updated.updatedAt,
    });
    return updated;
  }

  async createRevision(
    tenant: TenantContext,
    agentId: string,
    input: CreateRevisionInput,
    knownModels: ChatModel[] = listChatModels(),
  ): Promise<{ version: AgentVersionRecord }> {
    const agent = await this.requireOwned(tenant, agentId);
    if (isDefaultChatAgent(agent)) {
      throw new ApiError("default_agent_soul", "Default chat agent soul cannot be edited", 400);
    }
    const versions = await this.repo.listVersions(tenant.organizationId, agentId);
    const published = resolvePublishedVersion(agent, versions);
    const model = input.model ?? published.model;
    if (!getChatModel(model, knownModels)) {
      throw new ApiError("unknown_model", `Model '${model}' is not available`, 400);
    }
    const nextNumber = Math.max(...versions.map((version) => version.version), 0) + 1;
    const versionId = this.id();
    const version: AgentVersionRecord = {
      id: versionId,
      agentId,
      organizationId: tenant.organizationId,
      version: nextNumber,
      systemPrompt: input.systemPrompt ?? published.systemPrompt,
      model,
      inputModalities: input.inputModalities
        ? ensureModalities(input.inputModalities)
        : [...published.inputModalities],
      productModes: published.productModes ? [...published.productModes] : published.productModes,
      config: { ...published.config },
      createdAt: this.now(),
    };
    await this.repo.insertVersion(version);

    if (input.toolKeys !== undefined) {
      for (const toolKey of input.toolKeys) {
        await this.repo.insertBinding({
          id: this.id(),
          agentVersionId: versionId,
          organizationId: tenant.organizationId,
          toolKey,
          config: {},
          enabled: true,
        });
      }
    } else {
      const publishedBindings = await this.repo.listBindings(tenant.organizationId, published.id);
      for (const binding of publishedBindings) {
        await this.repo.insertBinding({
          id: this.id(),
          agentVersionId: versionId,
          organizationId: tenant.organizationId,
          toolKey: binding.toolKey,
          config: { ...binding.config },
          enabled: binding.enabled,
        });
      }
    }

    await this.repo.updateAgent(tenant.organizationId, agentId, {
      currentVersionId: versionId,
      updatedAt: this.now(),
    });
    return { version };
  }

  async share(tenant: TenantContext, agentId: string, visibility: Visibility): Promise<AgentRecord> {
    const agent = await this.requireOwned(tenant, agentId);
    const updated = { ...agent, visibility, updatedAt: this.now() };
    await this.repo.updateAgent(tenant.organizationId, agentId, {
      visibility,
      updatedAt: updated.updatedAt,
    });
    return updated;
  }

  async bindTool(tenant: TenantContext, agentId: string, versionId: string, toolKey: string): Promise<ToolBindingRecord> {
    await this.requireOwned(tenant, agentId);
    const version = await this.repo.findVersionById(tenant.organizationId, versionId);
    if (!version || version.agentId !== agentId) {
      throw new ApiError("not_found", "Version not found", 404);
    }
    const binding: ToolBindingRecord = {
      id: this.id(),
      agentVersionId: versionId,
      organizationId: tenant.organizationId,
      toolKey,
      config: {},
      enabled: true,
    };
    await this.repo.insertBinding(binding);
    return binding;
  }

  async getPublishedForRun(tenant: TenantContext, agentId: string): Promise<{
    agent: AgentRecord;
    version: AgentVersionRecord;
    bindings: ToolBindingRecord[];
  }> {
    const agent = await this.get(tenant, agentId);
    if (!agent) {
      throw new ApiError("not_found", "Agent not found", 404);
    }
    const versions = await this.repo.listVersions(tenant.organizationId, agentId);
    const version = resolvePublishedVersion(agent, versions);
    const bindings = await this.repo.listBindings(tenant.organizationId, version.id);
    return { agent, version, bindings };
  }

  async ensureDefaultChat(tenant: TenantContext): Promise<{
    agent: AgentRecord;
    version: AgentVersionRecord;
    bindings: ToolBindingRecord[];
  }> {
    const existing = (await this.repo.listAgents(tenant.organizationId, tenant.workspaceId)).find(
      (agent) => agent.slug === DEFAULT_CHAT_SLUG && agent.createdByUserId === tenant.userId,
    );
    if (existing) {
      if (!existing.currentVersionId) {
        const versions = await this.repo.listVersions(tenant.organizationId, existing.id);
        const latest = versions.sort((left, right) => right.version - left.version)[0];
        if (!latest) {
          throw new ApiError("unpublished_agent", "Default chat has no version", 500);
        }
        await this.repo.updateAgent(tenant.organizationId, existing.id, {
          currentVersionId: latest.id,
          updatedAt: this.now(),
        });
        existing.currentVersionId = latest.id;
      }
      const published = await this.getPublishedForRun(tenant, existing.id);
      published.bindings = await this.ensureStarterBindings(tenant, published.version.id, published.bindings);
      return published;
    }

    const timestamp = this.now();
    const agentId = this.id();
    const versionId = this.id();
    const agent: AgentRecord = {
      id: agentId,
      organizationId: tenant.organizationId,
      workspaceId: tenant.workspaceId,
      name: DEFAULT_CHAT_NAME,
      slug: DEFAULT_CHAT_SLUG,
      description: DEFAULT_CHAT_DESCRIPTION,
      visibility: "private",
      createdByUserId: tenant.userId,
      currentVersionId: versionId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const version: AgentVersionRecord = {
      id: versionId,
      agentId,
      organizationId: tenant.organizationId,
      version: 1,
      systemPrompt: DEFAULT_CHAT_PROMPT,
      model: DEFAULT_CHAT_MODEL,
      inputModalities: [...DEFAULT_CHAT_MODALITIES],
      productModes: ["chat"],
      config: {},
      createdAt: timestamp,
    };
    await this.repo.insertAgent(agent);
    await this.repo.insertVersion(version);
    const bindings: ToolBindingRecord[] = [];
    for (const toolKey of DEFAULT_CHAT_TOOLS) {
      const binding: ToolBindingRecord = {
        id: this.id(),
        agentVersionId: versionId,
        organizationId: tenant.organizationId,
        toolKey,
        config: {},
        enabled: true,
      };
      await this.repo.insertBinding(binding);
      bindings.push(binding);
    }
    return { agent, version, bindings };
  }

  private async ensureStarterBindings(
    tenant: TenantContext,
    versionId: string,
    bindings: ToolBindingRecord[],
  ): Promise<ToolBindingRecord[]> {
    const have = new Set(bindings.map((binding) => binding.toolKey));
    for (const toolKey of DEFAULT_CHAT_TOOLS) {
      if (have.has(toolKey)) {
        continue;
      }
      const binding: ToolBindingRecord = {
        id: this.id(),
        agentVersionId: versionId,
        organizationId: tenant.organizationId,
        toolKey,
        config: {},
        enabled: true,
      };
      await this.repo.insertBinding(binding);
      bindings.push(binding);
    }
    return bindings;
  }

  private async requireOwned(tenant: TenantContext, agentId: string): Promise<AgentRecord> {
    if (!canBuild(tenant.role)) {
      throw new ApiError("forbidden", "Builder role required", 403);
    }
    const agent = await this.repo.findAgentById(tenant.organizationId, agentId);
    if (!agent || agent.workspaceId !== tenant.workspaceId) {
      throw new ApiError("not_found", "Agent not found", 404);
    }
    if (agent.createdByUserId !== tenant.userId && !canAdminister(tenant.role)) {
      throw new ApiError("forbidden", "Only the creator can edit this agent", 403);
    }
    return agent;
  }
}
