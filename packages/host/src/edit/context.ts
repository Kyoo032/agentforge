import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantContext } from "@agentforge/core";

export type EditToolContext = {
  tenant: TenantContext;
  projectId: string;
  runId: string;
};

const storage = new AsyncLocalStorage<EditToolContext>();

export function withEditToolContext<T>(context: EditToolContext, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(context, fn);
}

export function getEditToolContext(): EditToolContext | undefined {
  return storage.getStore();
}

export function requireEditToolContext(): EditToolContext {
  const context = storage.getStore();
  if (!context) {
    throw new Error("edit_context_missing");
  }
  return context;
}
