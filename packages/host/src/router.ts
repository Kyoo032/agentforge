import { jsonOk } from "./errors";
import {
  handleGetAgent,
  handleGetAgentCapabilities,
  handleGetAgentThreads,
  handleGetWorkspaceAgents,
  handlePostAgentGenerateDefaults,
  handlePostAgentProductModes,
  handlePostAgentPublish,
  handlePostAgentShare,
  handlePostAgentSoul,
  handlePostAgentTools,
  handlePostWorkspaceAgents,
} from "./handlers/agents";
import { handleGetChat } from "./handlers/chat";
import { handleGetEditDoctor } from "./handlers/edit";
import { handlePostEnhancePrompt } from "./handlers/enhance-prompt";
import {
  handleGetImages,
  handleGetVideos,
  handlePostData,
  handlePostDocuments,
  handlePostDocumentsDocx,
  handlePostDocumentsRegen,
  handlePostImages,
  handlePostPresentations,
  handlePostPresentationsPptx,
  handlePostPresentationsRegen,
  handlePostResearch,
  handlePostVideos,
} from "./handlers/jobs";
import {
  handleDeleteKnowledgeMemory,
  handleDeleteKnowledgeSource,
  handleGetKnowledge,
  handleGetKnowledgeContext,
  handlePostKnowledgeMap,
  handlePostKnowledgeMemory,
  handlePostKnowledgeSource,
  handlePostKnowledgeSourceUrl,
  handlePutKnowledgeModels,
  handlePutKnowledgeSoul,
} from "./handlers/knowledge";
import { handleGetMediaFile, handlePostMedia } from "./handlers/media";
import {
  handleGetContext,
  handleGetOrganizations,
  handleGetTemplates,
  handleGetTools,
  handlePing,
} from "./handlers/misc";
import { handleGetModels, handlePostModels } from "./handlers/models";
import { handleRun } from "./handlers/runs";
import { handleGetSettings, handlePostSettings } from "./handlers/settings";
import { handleDeleteThread, handleGetThread, handleGetThreads, handlePostThreads } from "./handlers/threads";
import { handleGetUsage } from "./handlers/usage";
import {
  handleGetWorkspaces,
  handlePatchWorkspace,
  handlePostWorkspaces,
  handleSelectWorkspace,
} from "./handlers/workspaces";
import type { HostHandler, HostRequest, HostResult } from "./types";

type Route = {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: HostHandler;
};

function compile(method: string, path: string, handler: HostHandler): Route {
  const keys: string[] = [];
  const source = path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    keys.push(key);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${source}$`), keys, handler };
}

const routes: Route[] = [
  compile("GET", "/api/v1/ping", () => handlePing()),
  compile("GET", "/api/v1/edit/doctor", () => handleGetEditDoctor()),
  compile("GET", "/api/v1/settings", handleGetSettings),
  compile("POST", "/api/v1/settings", handlePostSettings),
  compile("GET", "/api/v1/usage", handleGetUsage),
  compile("GET", "/api/v1/chat", handleGetChat),
  compile("GET", "/api/v1/workspaces", handleGetWorkspaces),
  compile("POST", "/api/v1/workspaces", handlePostWorkspaces),
  compile("POST", "/api/v1/workspaces/:workspaceId/select", handleSelectWorkspace),
  compile("PATCH", "/api/v1/workspaces/:workspaceId", handlePatchWorkspace),
  compile("GET", "/api/v1/workspaces/:workspaceId/agents", handleGetWorkspaceAgents),
  compile("POST", "/api/v1/workspaces/:workspaceId/agents", handlePostWorkspaceAgents),
  compile("GET", "/api/v1/threads", handleGetThreads),
  compile("POST", "/api/v1/threads", handlePostThreads),
  compile("GET", "/api/v1/threads/:threadId", handleGetThread),
  compile("DELETE", "/api/v1/threads/:threadId", handleDeleteThread),
  compile("POST", "/api/v1/threads/:threadId/runs/text", (req) => handleRun(req, "text")),
  compile("POST", "/api/v1/threads/:threadId/runs/image", (req) => handleRun(req, "image")),
  compile("POST", "/api/v1/threads/:threadId/runs/video", (req) => handleRun(req, "video")),
  compile("GET", "/api/v1/models", handleGetModels),
  compile("POST", "/api/v1/models", handlePostModels),
  compile("POST", "/api/v1/media", handlePostMedia),
  compile("GET", "/api/v1/media/:mediaId/file", handleGetMediaFile),
  compile("GET", "/api/v1/images", handleGetImages),
  compile("POST", "/api/v1/images", handlePostImages),
  compile("GET", "/api/v1/videos", handleGetVideos),
  compile("POST", "/api/v1/videos", handlePostVideos),
  compile("POST", "/api/v1/documents", handlePostDocuments),
  compile("POST", "/api/v1/documents/regenerate", handlePostDocumentsRegen),
  compile("POST", "/api/v1/documents/docx", handlePostDocumentsDocx),
  compile("POST", "/api/v1/presentations", handlePostPresentations),
  compile("POST", "/api/v1/presentations/regenerate", handlePostPresentationsRegen),
  compile("POST", "/api/v1/presentations/pptx", handlePostPresentationsPptx),
  compile("POST", "/api/v1/research", handlePostResearch),
  compile("POST", "/api/v1/data", handlePostData),
  compile("POST", "/api/v1/prompts/enhance", handlePostEnhancePrompt),
  compile("GET", "/api/v1/knowledge", handleGetKnowledge),
  compile("GET", "/api/v1/knowledge/context", handleGetKnowledgeContext),
  compile("PUT", "/api/v1/knowledge/models", handlePutKnowledgeModels),
  compile("POST", "/api/v1/knowledge/map", handlePostKnowledgeMap),
  compile("PUT", "/api/v1/knowledge/soul", handlePutKnowledgeSoul),
  compile("POST", "/api/v1/knowledge/memories", handlePostKnowledgeMemory),
  compile("DELETE", "/api/v1/knowledge/memories/:memoryId", handleDeleteKnowledgeMemory),
  compile("POST", "/api/v1/knowledge/sources", handlePostKnowledgeSource),
  compile("POST", "/api/v1/knowledge/sources/url", handlePostKnowledgeSourceUrl),
  compile("DELETE", "/api/v1/knowledge/sources/:sourceId", handleDeleteKnowledgeSource),
  compile("GET", "/api/v1/agents/:agentId", handleGetAgent),
  compile("GET", "/api/v1/agents/:agentId/capabilities", handleGetAgentCapabilities),
  compile("GET", "/api/v1/agents/:agentId/threads", handleGetAgentThreads),
  compile("POST", "/api/v1/agents/:agentId/tools", handlePostAgentTools),
  compile("POST", "/api/v1/agents/:agentId/soul", handlePostAgentSoul),
  compile("POST", "/api/v1/agents/:agentId/publish", handlePostAgentPublish),
  compile("POST", "/api/v1/agents/:agentId/share", handlePostAgentShare),
  compile("POST", "/api/v1/agents/:agentId/product-modes", handlePostAgentProductModes),
  compile("POST", "/api/v1/agents/:agentId/generate-defaults", handlePostAgentGenerateDefaults),
  compile("GET", "/api/v1/tools", handleGetTools),
  compile("GET", "/api/v1/context", handleGetContext),
  compile("GET", "/api/v1/templates", handleGetTemplates),
  compile("GET", "/api/v1/organizations", handleGetOrganizations),
];

export async function dispatch(request: HostRequest): Promise<HostResult> {
  const method = request.method.toUpperCase();
  const path = request.path.replace(/\/+$/, "") || "/";
  for (const route of routes) {
    if (route.method !== method) {
      continue;
    }
    const match = route.pattern.exec(path);
    if (!match) {
      continue;
    }
    const params: Record<string, string> = { ...request.params };
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? "");
    });
    return route.handler({ ...request, params, path });
  }
  return jsonOk({ error: { code: "not_found", message: "Not found" } }, 404);
}
