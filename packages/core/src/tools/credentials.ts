/**
 * Tool-key routing stripped from Hermes Agent
 * (nousresearch/hermes-agent: tools_config.TOOL_CATEGORIES,
 * tools.web_tools._get_backend, tools.tool_backend_helpers.read_selection).
 *
 * Rules we keep:
 * 1. A stored backend selection is sticky. Adding another key does not reroute.
 * 2. Autodetect from env/settings keys only when no selection has been stored.
 * 3. Inference keys (OPENAI_API_KEY, ANTHROPIC, …) are never used for a
 *    capability unless that backend lists them. Web search never lists them.
 *    Image/video may reuse a chat key only after you pick that vendor.
 * 4. A selected-but-missing key is an honest error, not a silent fallback.
 * 5. Autodetect for image_gen / video_gen prefers the Toko Token gateway key
 *    (same OpenAI-compatible key as chat). FAL is optional BYOK. Native
 *    OpenAI Images / Ark Seedance stay explicit picks. A selected-but-missing
 *    key does not fall through.
 */

import { getSecret, getToolSelection, type ToolSecretScope } from "./secret-scope";

export type ToolSecretStore = {
  openaiApiKey?: string;
  googleApiKey?: string;
  anthropicApiKey?: string;
  volcengineApiKey?: string;
  openaiBaseUrl?: string;
  googleBaseUrl?: string;
  anthropicBaseUrl?: string;
  volcengineBaseUrl?: string;
  toolKeys?: Record<string, string>;
  toolBackends?: Record<string, string>;
  imageGenModel?: string;
  videoGenModel?: string;
  disabledTools?: string[];
};

export type ToolBackendSpec = {
  id: string;
  label: string;
  envVars: string[];
  urlVars?: string[];
};

export type ToolCapabilitySpec = {
  id: string;
  label: string;
  description: string;
  backends: ToolBackendSpec[];
  autodectOrder: string[];
};

export type ToolRoute = {
  capability: string;
  backend: string;
  source: "selection" | "autodetect";
  envVar?: string;
  baseUrl?: string;
  ready: boolean;
};

export const TOOL_CAPABILITIES: ToolCapabilitySpec[] = [
  {
    id: "web",
    label: "Web search",
    description: "web_search. Uses Tavily or Brave. Chat model keys are not reused.",
    backends: [
      {
        id: "tavily",
        label: "Tavily",
        envVars: ["TAVILY_API_KEY"],
        urlVars: ["TAVILY_BASE_URL"],
      },
      {
        id: "brave-free",
        label: "Brave Search",
        envVars: ["BRAVE_SEARCH_API_KEY"],
      },
    ],
    autodectOrder: ["tavily", "brave-free"],
  },
  {
    id: "image_gen",
    label: "Image generation",
    description: "image_generate. Toko Token gateway by default. FAL or native OpenAI Images if you pick them.",
    backends: [
      {
        id: "gateway",
        label: "Toko Token gateway",
        envVars: ["OPENAI_API_KEY"],
        urlVars: ["OPENAI_BASE_URL"],
      },
      {
        id: "fal",
        label: "FAL.ai",
        envVars: ["FAL_KEY"],
      },
      {
        id: "openai",
        label: "OpenAI Images",
        envVars: ["OPENAI_API_KEY"],
        urlVars: ["OPENAI_BASE_URL"],
      },
    ],
    autodectOrder: ["gateway", "fal"],
  },
  {
    id: "video_gen",
    label: "Video generation",
    description: "video_generate. Toko Token gateway by default. FAL or Volcengine Seedance if you pick them.",
    backends: [
      {
        id: "gateway",
        label: "Toko Token gateway",
        envVars: ["OPENAI_API_KEY"],
        urlVars: ["OPENAI_BASE_URL"],
      },
      {
        id: "fal",
        label: "FAL.ai",
        envVars: ["FAL_KEY"],
      },
      {
        id: "volcengine",
        label: "Volcengine Seedance",
        envVars: ["ARK_API_KEY"],
        urlVars: ["ARK_BASE_URL"],
      },
    ],
    autodectOrder: ["gateway", "fal"],
  },
];

/** Chat/inference secrets. Never shown as tool-key fields; reused only when a backend lists them. */
export const CHAT_INFERENCE_ENV_VARS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ARK_API_KEY",
  "VOLCENGINE_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "GOOGLE_GENERATIVE_AI_BASE_URL",
  "ARK_BASE_URL",
  "VOLCENGINE_BASE_URL",
]);

export function listDedicatedToolSecretNames(): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const capability of TOOL_CAPABILITIES) {
    for (const backend of capability.backends) {
      for (const name of [...backend.envVars, ...(backend.urlVars ?? [])]) {
        if (CHAT_INFERENCE_ENV_VARS.has(name) || seen.has(name)) {
          continue;
        }
        seen.add(name);
        names.push(name);
      }
    }
  }
  return names;
}

export function listDedicatedToolKeyNames(): string[] {
  return listDedicatedToolSecretNames().filter((name) => !name.endsWith("_BASE_URL") && !name.endsWith("_API_URL"));
}

export function missingToolRouteMessage(route: ToolRoute, idleHint: string): string {
  if (route.source === "selection" && route.backend) {
    return `This tool is set to ${route.backend} but that API key is missing. Add it in Settings.`;
  }
  return idleHint;
}

export function listToolCapabilities(): ToolCapabilitySpec[] {
  return TOOL_CAPABILITIES;
}

export function getToolCapability(id: string): ToolCapabilitySpec | undefined {
  return TOOL_CAPABILITIES.find((item) => item.id === id);
}

function readValue(name: string, secrets?: Record<string, string>): string | undefined {
  if (secrets) {
    const value = secrets[name];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  }
  return getSecret(name);
}

function backendReady(backend: ToolBackendSpec, secrets?: Record<string, string>): { envVar?: string; baseUrl?: string; ready: boolean } {
  const envVar = backend.envVars.find((name) => readValue(name, secrets));
  const urlVar = backend.urlVars?.find((name) => readValue(name, secrets));
  const needsKey = backend.envVars.length > 0;
  const ready = needsKey ? Boolean(envVar) : Boolean(urlVar) || backend.envVars.length === 0;
  return {
    envVar,
    baseUrl: urlVar ? readValue(urlVar, secrets) : undefined,
    ready,
  };
}

export function resolveToolBackend(
  capabilityId: string,
  input: { selection?: string | null; secrets?: Record<string, string> } = {},
): ToolRoute {
  const capability = getToolCapability(capabilityId);
  if (!capability) {
    return { capability: capabilityId, backend: "", source: "autodetect", ready: false };
  }

  const stored =
    input.selection === undefined ? getToolSelection(capabilityId) : input.selection?.trim() || undefined;

  if (stored) {
    const spec = capability.backends.find((item) => item.id === stored);
    const status = spec ? backendReady(spec, input.secrets) : { ready: false };
    return {
      capability: capabilityId,
      backend: stored,
      source: "selection",
      envVar: status.envVar,
      baseUrl: status.baseUrl,
      ready: Boolean(spec) && status.ready,
    };
  }

  for (const id of capability.autodectOrder) {
    const spec = capability.backends.find((item) => item.id === id);
    if (!spec) {
      continue;
    }
    const status = backendReady(spec, input.secrets);
    if (status.ready) {
      return {
        capability: capabilityId,
        backend: id,
        source: "autodetect",
        envVar: status.envVar,
        baseUrl: status.baseUrl,
        ready: true,
      };
    }
  }

  const fallback = capability.autodectOrder[0] ?? capability.backends[0]?.id ?? "";
  return { capability: capabilityId, backend: fallback, source: "autodetect", ready: false };
}

export function secretMapFromSettings(
  settings: ToolSecretStore,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const map: Record<string, string> = {};
  const put = (name: string, value?: string) => {
    if (value && value.trim().length > 0) {
      map[name] = value.trim();
    }
  };
  put("OPENAI_API_KEY", settings.openaiApiKey || env.OPENAI_API_KEY);
  put("OPENAI_BASE_URL", settings.openaiBaseUrl || env.OPENAI_BASE_URL);
  put("ANTHROPIC_API_KEY", settings.anthropicApiKey || env.ANTHROPIC_API_KEY);
  put("GOOGLE_GENERATIVE_AI_API_KEY", settings.googleApiKey || env.GOOGLE_GENERATIVE_AI_API_KEY);
  put("ARK_API_KEY", settings.volcengineApiKey || env.ARK_API_KEY || env.VOLCENGINE_API_KEY);
  put("ARK_BASE_URL", settings.volcengineBaseUrl || env.ARK_BASE_URL || env.VOLCENGINE_BASE_URL);
  put("IMAGE_GEN_MODEL", settings.imageGenModel || env.IMAGE_GEN_MODEL);
  put("VIDEO_GEN_MODEL", settings.videoGenModel || env.VIDEO_GEN_MODEL);
  for (const [name, value] of Object.entries(settings.toolKeys ?? {})) {
    put(name, value);
  }
  for (const capability of TOOL_CAPABILITIES) {
    for (const backend of capability.backends) {
      for (const name of [...backend.envVars, ...(backend.urlVars ?? [])]) {
        if (!map[name]) {
          put(name, env[name]);
        }
      }
    }
  }
  return map;
}

export function buildToolSecretScope(settings: ToolSecretStore, env: NodeJS.ProcessEnv = process.env): ToolSecretScope {
  const backends: Record<string, string> = {};
  for (const [capability, backend] of Object.entries(settings.toolBackends ?? {})) {
    if (backend.trim().length > 0) {
      backends[capability] = backend.trim();
    }
  }
  const disabledTools = (settings.disabledTools ?? [])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return { secrets: secretMapFromSettings(settings, env), backends, disabledTools };
}

export function listToolRoutes(settings: ToolSecretStore, env: NodeJS.ProcessEnv = process.env): Record<string, ToolRoute> {
  const secrets = secretMapFromSettings(settings, env);
  const routes: Record<string, ToolRoute> = {};
  for (const capability of TOOL_CAPABILITIES) {
    routes[capability.id] = resolveToolBackend(capability.id, {
      selection: settings.toolBackends?.[capability.id],
      secrets,
    });
  }
  return routes;
}

export function maskToolKeys(settings: ToolSecretStore): Record<string, boolean> {
  const has: Record<string, boolean> = {};
  for (const name of listDedicatedToolSecretNames()) {
    has[name] = Boolean(settings.toolKeys?.[name]?.trim());
  }
  for (const name of Object.keys(settings.toolKeys ?? {})) {
    if (!(name in has) && !CHAT_INFERENCE_ENV_VARS.has(name)) {
      has[name] = Boolean(settings.toolKeys?.[name]?.trim());
    }
  }
  return has;
}
