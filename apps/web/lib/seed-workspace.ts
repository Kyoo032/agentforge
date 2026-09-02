import {
  WORKSPACE_TEMPLATES,
  defaultAgentPack,
  defaultAgentTemplate,
  type AgentPack,
  type AgentTemplate,
  type TenantContext,
} from "@agentforge/core";
import { legalAgentPacks } from "@agentforge/legal";
import { marketingAgentPacks } from "@agentforge/marketing";
import { agentPacks as universityAgentPacks } from "@agentforge/university";
import { agentService } from "@/lib/tenant";
import { revalidateAppShell } from "@/lib/revalidate-shell";
import { ensureToolsRegistered } from "@/lib/register-tools";
import { defaultSelectableModel, listSelectableModels } from "@/lib/selectable-models";

function allPacks(): AgentPack[] {
  return [defaultAgentPack, ...universityAgentPacks, ...marketingAgentPacks, ...legalAgentPacks];
}

function packTemplateFor(templatePack: string): AgentTemplate | undefined {
  const pack = allPacks().find((entry) => entry.id === templatePack);
  if (!pack) {
    return undefined;
  }
  return pack.templates.find((template) => template.key === templatePack) ?? pack.templates[0];
}

function genericStarter(templatePack: string): {
  name: string;
  description: string;
  systemPrompt: string;
  productModes: AgentTemplate["productModes"];
  inputModalities: AgentTemplate["inputModalities"];
  toolKeys: string[];
} {
  const label =
    WORKSPACE_TEMPLATES.find((entry) => entry.id === templatePack)?.label ?? templatePack;
  return {
    name: `${label} assistant`,
    description: `Starter agent for the ${label} workspace.`,
    systemPrompt: defaultAgentTemplate.systemPrompt,
    productModes: ["chat", "agents"],
    inputModalities: [...defaultAgentTemplate.inputModalities],
    toolKeys: [...defaultAgentTemplate.toolKeys],
  };
}

function resolveStarter(templatePack: string): {
  name: string;
  description: string;
  systemPrompt: string;
  productModes: AgentTemplate["productModes"];
  inputModalities: AgentTemplate["inputModalities"];
  toolKeys: string[];
} {
  const fromPack = packTemplateFor(templatePack);
  if (fromPack) {
    return {
      name: fromPack.name,
      description: fromPack.description,
      systemPrompt: fromPack.systemPrompt,
      productModes: fromPack.productModes?.length ? fromPack.productModes : ["chat", "agents"],
      inputModalities: fromPack.inputModalities?.length ? fromPack.inputModalities : ["text"],
      toolKeys: [...fromPack.toolKeys],
    };
  }
  return genericStarter(templatePack);
}

/**
 * Create + publish one starter agent for a newly created workspace.
 * Failures are logged and returned as false — callers must still 201 the workspace.
 */
export async function seedWorkspaceStarter(
  tenant: TenantContext,
  workspaceId: string,
  templatePack: string,
): Promise<boolean> {
  try {
    ensureToolsRegistered();
    const seedTenant: TenantContext = { ...tenant, workspaceId };
    const starter = resolveStarter(templatePack);
    const models = listSelectableModels();
    const model = defaultSelectableModel(models);
    const created = await agentService.create(
      seedTenant,
      {
        name: starter.name,
        description: starter.description,
        systemPrompt: starter.systemPrompt,
        model,
        inputModalities: starter.inputModalities,
        productModes: starter.productModes,
      },
      models,
    );
    for (const toolKey of starter.toolKeys) {
      await agentService.bindTool(seedTenant, created.agent.id, created.version.id, toolKey);
    }
    await agentService.publish(seedTenant, created.agent.id, created.version.id);
    revalidateAppShell();
    return true;
  } catch (error) {
    console.error("[seed-workspace] failed to seed starter agent", {
      workspaceId,
      templatePack,
      error,
    });
    return false;
  }
}
