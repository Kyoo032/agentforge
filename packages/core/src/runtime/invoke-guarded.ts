import type { ZodTypeAny } from "zod";
import type { TenantContext } from "../tenancy/types";
import { invokeTool, type ToolDefinition } from "../tools/define-tool";
import { getDisabledTools, getInjectionGuardBypass } from "../tools/secret-scope";
import { blockedInjectionOutput, scanJson } from "../security/injection-guard";
import { thinToolOutput } from "../security/tool-thin";
import { reportToolIo } from "./tool-io";

function disabledOutput(toolKey: string): { success: false; error: string } {
  return { success: false, error: `Tool ${toolKey} is disabled on this machine.` };
}

/**
 * One choke for live + stub tool calls: disabled-tools, injection scan, execute, thin.
 * Full output is reported to the ALS sink; the return value is thinned for the model.
 */
/** Tools whose output is attacker-reachable text: scanned for injection before the model sees it. */
const NETWORK_SOURCED_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "market_quotes",
  "market_history",
  "market_technical",
  "market_news",
  "market_macro",
]);

export async function invokeToolGuarded(
  tool: ToolDefinition<ZodTypeAny>,
  rawArgs: unknown,
  tenant: TenantContext,
): Promise<unknown> {
  if (getDisabledTools().includes(tool.key)) {
    const blocked = disabledOutput(tool.key);
    reportToolIo({ toolKey: tool.key, input: rawArgs, full: blocked, thin: blocked });
    return blocked;
  }

  if (!getInjectionGuardBypass()) {
    const hit = scanJson(rawArgs);
    if (hit) {
      const blocked = blockedInjectionOutput(hit);
      reportToolIo({ toolKey: tool.key, input: rawArgs, full: blocked, thin: blocked });
      return blocked;
    }
  }

  const full = await invokeTool(tool, rawArgs, tenant);
  let thin = thinToolOutput(tool.key, full);

  if (!getInjectionGuardBypass() && NETWORK_SOURCED_TOOLS.has(tool.key)) {
    const searchHit = scanJson(thin);
    if (searchHit) {
      thin = blockedInjectionOutput(searchHit);
    }
  }

  reportToolIo({ toolKey: tool.key, input: rawArgs, full, thin });
  return thin;
}
