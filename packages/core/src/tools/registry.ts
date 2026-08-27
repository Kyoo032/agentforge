import type { ToolDefinition } from "./define-tool";
import type { ZodTypeAny } from "zod";

const handlers = new Map<string, ToolDefinition<ZodTypeAny>>();

export function registerTool(tool: ToolDefinition<any>): void {
  handlers.set(tool.key, tool);
}

export function getTool(key: string): ToolDefinition<ZodTypeAny> | undefined {
  return handlers.get(key);
}

export function listTools(): ToolDefinition<ZodTypeAny>[] {
  return [...handlers.values()];
}

/** Pack tools stay hidden on blank chat/build until that pack's template is chosen. */
export function listStudioTools(pack?: string | null): ToolDefinition<ZodTypeAny>[] {
  const selected = pack?.trim() || undefined;
  return listTools().filter((tool) => !tool.pack || tool.pack === selected);
}

export function resetToolRegistry(): void {
  handlers.clear();
}
