import { AsyncLocalStorage } from "node:async_hooks";

export type ToolSecretScope = {
  secrets: Record<string, string>;
  backends: Record<string, string>;
  disabledTools?: string[];
  injectionGuardBypass?: boolean;
};

const storage = new AsyncLocalStorage<ToolSecretScope>();

export function runWithToolSecrets<T>(scope: ToolSecretScope, fn: () => T): T {
  return storage.run(scope, fn);
}

export function getSecret(name: string): string | undefined {
  const scoped = storage.getStore()?.secrets[name];
  if (typeof scoped === "string" && scoped.trim().length > 0) {
    return scoped.trim();
  }
  const fromEnv = process.env[name];
  return typeof fromEnv === "string" && fromEnv.trim().length > 0 ? fromEnv.trim() : undefined;
}

export function getToolSelection(capability: string): string | undefined {
  const value = storage.getStore()?.backends[capability];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function getDisabledTools(): string[] {
  return storage.getStore()?.disabledTools ?? [];
}

export function getInjectionGuardBypass(): boolean {
  return storage.getStore()?.injectionGuardBypass === true;
}
