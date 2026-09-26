import type { ToolBindingRecord } from "../../agents/service";
import { EDIT_TOOLS } from "./tools";

/** Every edit tool, enabled. The live agent has nothing to call when this list is empty. */
export function editAgentBindings(organizationId: string): ToolBindingRecord[] {
  return EDIT_TOOLS.map((tool) => ({
    id: `edit-${tool.key}`,
    agentVersionId: "edit",
    organizationId,
    toolKey: tool.key,
    config: {},
    enabled: true,
  }));
}
