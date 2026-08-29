import type { AgentRecord, AgentRepository, AgentVersionRecord, ToolBindingRecord } from "./service";

export class MemoryAgentRepository implements AgentRepository {
  agents: AgentRecord[] = [];
  versions: AgentVersionRecord[] = [];
  bindings: ToolBindingRecord[] = [];

  async insertAgent(agent: AgentRecord): Promise<void> {
    this.agents.push(agent);
  }

  async insertVersion(version: AgentVersionRecord): Promise<void> {
    this.versions.push(version);
  }

  async insertBinding(binding: ToolBindingRecord): Promise<void> {
    this.bindings.push(binding);
  }

  async findAgentById(organizationId: string, agentId: string): Promise<AgentRecord | null> {
    return this.agents.find((agent) => agent.id === agentId && agent.organizationId === organizationId) ?? null;
  }

  async listAgents(organizationId: string, workspaceId: string): Promise<AgentRecord[]> {
    return this.agents.filter(
      (agent) => agent.organizationId === organizationId && agent.workspaceId === workspaceId,
    );
  }

  async findVersionById(organizationId: string, versionId: string): Promise<AgentVersionRecord | null> {
    return (
      this.versions.find((version) => version.id === versionId && version.organizationId === organizationId) ??
      null
    );
  }

  async listVersions(organizationId: string, agentId: string): Promise<AgentVersionRecord[]> {
    return this.versions.filter(
      (version) => version.organizationId === organizationId && version.agentId === agentId,
    );
  }

  async listBindings(organizationId: string, agentVersionId: string): Promise<ToolBindingRecord[]> {
    return this.bindings.filter(
      (binding) => binding.organizationId === organizationId && binding.agentVersionId === agentVersionId,
    );
  }

  async updateAgent(organizationId: string, agentId: string, patch: Partial<AgentRecord>): Promise<void> {
    const index = this.agents.findIndex(
      (agent) => agent.id === agentId && agent.organizationId === organizationId,
    );
    if (index === -1) {
      return;
    }
    this.agents[index] = { ...this.agents[index], ...patch };
  }

  async updateVersion(
    organizationId: string,
    versionId: string,
    patch: Partial<Pick<AgentVersionRecord, "productModes">>,
  ): Promise<void> {
    const index = this.versions.findIndex(
      (version) => version.id === versionId && version.organizationId === organizationId,
    );
    if (index === -1) {
      return;
    }
    this.versions[index] = { ...this.versions[index], ...patch };
  }
}
