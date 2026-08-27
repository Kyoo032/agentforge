import { AiSdkRuntime } from "./ai-sdk-runtime";
import { StubRuntime } from "./stub-runtime";
import type { AgentRuntime } from "./types";
import { resolveProviderKeys, resolveRuntimeMode, hasLiveProvider, type StoredSecrets } from "../secrets";
import { buildToolSecretScope } from "../tools/credentials";
import { runWithToolSecrets } from "../tools/secret-scope";

function withToolSecrets(runtime: AgentRuntime, settings: StoredSecrets): AgentRuntime {
  const scope = buildToolSecretScope(settings);
  return {
    execute: (input) => runWithToolSecrets(scope, () => runtime.execute(input)),
  };
}

export function createRuntime(settings: StoredSecrets = {}): AgentRuntime {
  const keys = resolveProviderKeys(settings);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  const runtime = mode === "ai" ? new AiSdkRuntime(keys) : new StubRuntime();
  return withToolSecrets(runtime, settings);
}
