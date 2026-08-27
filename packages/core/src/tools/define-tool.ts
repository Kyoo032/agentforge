import { z, type ZodTypeAny } from "zod";
import { ApiError } from "../errors";
import type { TenantContext } from "../tenancy/types";

export type ToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny> = {
  key: string;
  name: string;
  description: string;
  schema: TSchema;
  handlerKey: string;
  capability?: string;
  pack?: string;
  execute: (args: z.infer<TSchema>, tenant: TenantContext) => Promise<unknown>;
};

export function defineTool<TSchema extends ZodTypeAny>(config: {
  key: string;
  name: string;
  description: string;
  schema: TSchema;
  handlerKey?: string;
  capability?: string;
  pack?: string;
  execute: (args: z.infer<TSchema>, tenant: TenantContext) => Promise<unknown>;
}): ToolDefinition<TSchema> {
  return {
    key: config.key,
    name: config.name,
    description: config.description,
    schema: config.schema,
    handlerKey: config.handlerKey ?? config.key,
    capability: config.capability,
    pack: config.pack,
    execute: config.execute,
  };
}

export async function invokeTool(
  tool: ToolDefinition<ZodTypeAny>,
  rawArgs: unknown,
  tenant: TenantContext,
): Promise<unknown> {
  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    throw new ApiError("invalid_tool_args", parsed.error.message, 400);
  }
  return tool.execute(parsed.data, tenant);
}
