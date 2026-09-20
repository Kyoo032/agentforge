import { AsyncLocalStorage } from "node:async_hooks";
import { providerEnv } from "../server-mode";

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

/**
 * Phase 4 — the last door out of the tenant's own scope, and the one the first two sweeps missed.
 *
 * The scope is the tenant's: `secretMapFromSettings` builds it from their saved settings. The
 * fallback underneath was the **process's** environment, read by whatever name a tool asked for, so
 * on a hosted box a tenant's run picked up the operator's `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`
 * or `FAL_KEY` — and would have picked up their `OPENAI_API_KEY` too, for any caller that reached
 * here rather than through `resolveProviderKeys`. Route checks and the stub runtime kept the
 * gateway half out of reach, but the search half was live for any hosted tenant with web search
 * bound, which is a tenant spending credit that is not theirs and is metered against nobody.
 *
 * It reads `providerEnv()` now, which is frozen and empty in server mode. Off it nothing changes:
 * a desk, webdev and the frozen desktop still autodetect a tool key from the environment, which is
 * the documented BYOK path.
 *
 * The index is dynamic, so neither of the earlier sweeps could see it. `provider-env-sweep.test.ts`
 * now flags every dynamic `process.env[…]` read in shipped source, with an allowlist that has to
 * prove each exception reads operator configuration rather than a credential.
 */
export function getSecret(name: string): string | undefined {
  const scoped = storage.getStore()?.secrets[name];
  if (typeof scoped === "string" && scoped.trim().length > 0) {
    return scoped.trim();
  }
  const fromEnv = providerEnv()[name];
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
