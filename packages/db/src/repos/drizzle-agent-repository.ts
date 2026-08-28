import { and, eq } from "drizzle-orm";
import type {
  AgentRecord,
  AgentRepository,
  AgentVersionRecord,
  InputModality,
  ProductMode,
  ToolBindingRecord,
  Visibility,
} from "@agentforge/core";
import { openPayload, sealPayload } from "@agentforge/core";
import type { Database } from "../client";
import { agentToolBindings, agentVersions, agents } from "../schema";
import { getLocalVaultKey } from "../vault-key";

function sealText(value: string): string {
  return JSON.stringify(sealPayload(value, getLocalVaultKey()));
}

function openText(value: string): string {
  let candidate: unknown = value;
  try {
    candidate = JSON.parse(value);
  } catch {
    candidate = value;
  }
  const opened = openPayload<unknown>(candidate, getLocalVaultKey());
  return typeof opened === "string" ? opened : value;
}

function toAgent(row: typeof agents.$inferSelect): AgentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visibility: row.visibility as Visibility,
    createdByUserId: row.createdByUserId,
    currentVersionId: row.currentVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVersion(row: typeof agentVersions.$inferSelect): AgentVersionRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    organizationId: row.organizationId,
    version: row.version,
    systemPrompt: openText(row.systemPrompt),
    model: row.model,
    inputModalities: row.inputModalities as InputModality[],
    productModes: Array.isArray(row.productModes) ? (row.productModes as ProductMode[]) : null,
    config: row.config,
    createdAt: row.createdAt,
  };
}

function toBinding(row: typeof agentToolBindings.$inferSelect): ToolBindingRecord {
  return {
    id: row.id,
    agentVersionId: row.agentVersionId,
    organizationId: row.organizationId,
    toolKey: row.toolKey,
    config: row.config,
    enabled: row.enabled,
  };
}

export class DrizzleAgentRepository implements AgentRepository {
  constructor(private readonly db: Database) {}

  async insertAgent(agent: AgentRecord): Promise<void> {
    await this.db.insert(agents).values(agent);
  }

  async insertVersion(version: AgentVersionRecord): Promise<void> {
    await this.db.insert(agentVersions).values({
      ...version,
      systemPrompt: sealText(version.systemPrompt),
      productModes: version.productModes ?? null,
    });
  }

  async insertBinding(binding: ToolBindingRecord): Promise<void> {
    await this.db.insert(agentToolBindings).values(binding);
  }

  async findAgentById(organizationId: string, agentId: string): Promise<AgentRecord | null> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), eq(agents.id, agentId)))
      .limit(1);
    return rows[0] ? toAgent(rows[0]) : null;
  }

  async listAgents(organizationId: string, workspaceId: string): Promise<AgentRecord[]> {
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.organizationId, organizationId), eq(agents.workspaceId, workspaceId)));
    return rows.map(toAgent);
  }

  async findVersionById(organizationId: string, versionId: string): Promise<AgentVersionRecord | null> {
    const rows = await this.db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.organizationId, organizationId), eq(agentVersions.id, versionId)))
      .limit(1);
    return rows[0] ? toVersion(rows[0]) : null;
  }

  async listVersions(organizationId: string, agentId: string): Promise<AgentVersionRecord[]> {
    const rows = await this.db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.organizationId, organizationId), eq(agentVersions.agentId, agentId)));
    return rows.map(toVersion);
  }

  async listBindings(organizationId: string, agentVersionId: string): Promise<ToolBindingRecord[]> {
    const rows = await this.db
      .select()
      .from(agentToolBindings)
      .where(
        and(
          eq(agentToolBindings.organizationId, organizationId),
          eq(agentToolBindings.agentVersionId, agentVersionId),
        ),
      );
    return rows.map(toBinding);
  }

  async updateAgent(organizationId: string, agentId: string, patch: Partial<AgentRecord>): Promise<void> {
    await this.db
      .update(agents)
      .set(patch)
      .where(and(eq(agents.organizationId, organizationId), eq(agents.id, agentId)));
  }

  async updateVersion(
    organizationId: string,
    versionId: string,
    patch: Partial<Pick<AgentVersionRecord, "productModes">>,
  ): Promise<void> {
    await this.db
      .update(agentVersions)
      .set({ productModes: patch.productModes ?? null })
      .where(and(eq(agentVersions.organizationId, organizationId), eq(agentVersions.id, versionId)));
  }
}
