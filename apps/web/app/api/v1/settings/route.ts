import { NextResponse } from "next/server";
import {
  hasLiveProvider,
  listToolCapabilities,
  listToolRoutes,
  maskSecrets,
  normalizeEndpointUrl,
  resolveRuntimeMode,
} from "@agentforge/core";
import { jsonError } from "@/lib/http";
import { getTenant } from "@/lib/tenant";
import { loadSettings, saveSettings } from "@/lib/settings-store";
import { refreshModelCache, modeCatalogPayload } from "@/lib/selectable-models";
import { loadAccountUsage } from "@/lib/account-usage";
import { probeSummary } from "@/lib/model-cache";

function readUrl(value: unknown, fallback: "openai" | "anthropic" | "google" | "volcengine"): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return normalizeEndpointUrl(value, fallback).url;
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const next: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") {
      next[key] = item;
    }
  }
  return next;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function settingsPayload(settings: ReturnType<typeof loadSettings>) {
  return {
    ...maskSecrets(settings),
    runtime: resolveRuntimeMode({
      settingsHasKey: hasLiveProvider(settings),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    }),
    probe: probeSummary(),
    ...modeCatalogPayload(),
    toolCatalog: listToolCapabilities().map((capability) => ({
      id: capability.id,
      label: capability.label,
      description: capability.description,
      backends: capability.backends.map((backend) => ({
        id: backend.id,
        label: backend.label,
        envVars: backend.envVars,
        urlVars: backend.urlVars ?? [],
      })),
    })),
    toolRoutes: listToolRoutes(settings),
  };
}

async function settingsPayloadWithUsage(
  settings: ReturnType<typeof loadSettings>,
  tenant: Awaited<ReturnType<typeof getTenant>>,
) {
  return {
    ...settingsPayload(settings),
    usage: await loadAccountUsage(settings, tenant),
  };
}

export async function GET() {
  try {
    const tenant = await getTenant();
    return NextResponse.json(await settingsPayloadWithUsage(loadSettings(), tenant));
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const tenant = await getTenant();
    const body = (await request.json()) as Record<string, unknown>;
    const saved = saveSettings({
      openaiApiKey: typeof body.openaiApiKey === "string" ? body.openaiApiKey : undefined,
      googleApiKey: typeof body.googleApiKey === "string" ? body.googleApiKey : undefined,
      anthropicApiKey: typeof body.anthropicApiKey === "string" ? body.anthropicApiKey : undefined,
      volcengineApiKey: typeof body.volcengineApiKey === "string" ? body.volcengineApiKey : undefined,
      openaiBaseUrl: readUrl(body.openaiBaseUrl, "openai"),
      googleBaseUrl: readUrl(body.googleBaseUrl, "google"),
      anthropicBaseUrl: readUrl(body.anthropicBaseUrl, "anthropic"),
      volcengineBaseUrl: readUrl(body.volcengineBaseUrl, "volcengine"),
      toolKeys: readStringMap(body.toolKeys),
      toolBackends: readStringMap(body.toolBackends),
      imageGenModel: readOptionalString(body.imageGenModel),
      videoGenModel: readOptionalString(body.videoGenModel),
      documentGenModel: readOptionalString(body.documentGenModel),
      researchGenModel: readOptionalString(body.researchGenModel),
      presentationGenModel: readOptionalString(body.presentationGenModel),
      disabledTools: readStringArray(body.disabledTools),
    });
    await refreshModelCache(saved);
    const catalog = modeCatalogPayload();
    return NextResponse.json({
      ...(await settingsPayloadWithUsage(saved, tenant)),
      modes: catalog.modes,
      defaults: catalog.defaults,
    });
  } catch (error) {
    return jsonError(error);
  }
}
