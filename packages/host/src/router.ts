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
import {
  handleDeleteArtifact,
  handleGetArtifact,
  handleGetArtifactFile,
  handleGetArtifacts,
} from "./handlers/artifacts";
import { handleGetChat } from "./handlers/chat";
import { handleDeleteDataset, handleGetDataset, handleGetDatasets, handlePostDatasets } from "./handlers/datasets";
import {
  handleGetEditDoctor,
  handleGetEditEvents,
  handleGetEditExportFile,
  handleGetEditJob,
  handleGetEditMetrics,
  handleGetEditProject,
  handleGetEditProjects,
  handlePostEditAgent,
  handlePostEditExport,
  handlePostEditGenerate,
  handlePostEditImport,
  handlePostEditJobCancel,
  handlePostEditJobs,
  handlePostEditKeep,
  handlePostEditOps,
  handlePostEditParity,
  handlePostEditProjects,
  handlePostEditUndo,
  handlePostEditUnplacedDiscard,
  handlePostEditUnplacedPlace,
} from "./handlers/edit";
import { handlePostEnhancePrompt } from "./handlers/enhance-prompt";
import {
  handlePostFinance,
  handlePostFinanceDocx,
  handlePostFinanceParse,
  handlePostFinanceRegen,
  handlePostFinanceStream,
} from "./handlers/finance";
import {
  handlePostMarket,
  handlePostMarketBoard,
  handlePostMarketDocx,
  handlePostMarketRegen,
  handlePostMarketStream,
} from "./handlers/market";
import {
  handleGetImages,
  handleGetVideos,
  handlePostData,
  handlePostDataStream,
  handlePostDocuments,
  handlePostDocumentsDocx,
  handlePostDocumentsRegen,
  handlePostImages,
  handlePostPresentations,
  handlePostPresentationsPptx,
  handlePostPresentationsRegen,
  handlePostResearch,
  handlePostResearchStream,
  handlePostVideos,
} from "./handlers/jobs";
import {
  handleDeleteKnowledgeMemory,
  handleDeleteKnowledgeSource,
  handleGetKnowledge,
  handleGetKnowledgeContext,
  handleGetKnowledgeGraph,
  handlePostKnowledgeMap,
  handlePostKnowledgeMemory,
  handlePostKnowledgeSource,
  handlePostKnowledgeSourceUrl,
  handlePostKnowledgeVerify,
  handlePutKnowledgeModels,
  handlePutKnowledgeSoul,
} from "./handlers/knowledge";
import {
  handleDeleteLegalMatter,
  handleDeleteLegalMatterFile,
  handleGetLegalMatter,
  handleGetLegalMatters,
  handleGetLegalPlaybooks,
  handleGetLegalRun,
  handlePatchLegalMatter,
  handlePostLegalMatterFile,
  handlePostLegalMatters,
  handlePostLegalRunStream,
} from "./handlers/legal";
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
import { handleGetVideoExampleFile, handleGetVideoExamples } from "./handlers/video-examples";
import {
  handleDeleteWorkspace,
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
  compile("GET", "/api/v1/edit/doctor", handleGetEditDoctor),
  compile("GET", "/api/v1/edit/metrics", handleGetEditMetrics),
  compile("GET", "/api/v1/edit/projects", handleGetEditProjects),
  compile("POST", "/api/v1/edit/projects", handlePostEditProjects),
  compile("GET", "/api/v1/edit/projects/:projectId", handleGetEditProject),
  compile("POST", "/api/v1/edit/projects/:projectId/ops", handlePostEditOps),
  compile("POST", "/api/v1/edit/projects/:projectId/undo", handlePostEditUndo),
  compile("POST", "/api/v1/edit/projects/:projectId/cards/:cardId/keep", handlePostEditKeep),
  compile("POST", "/api/v1/edit/projects/:projectId/import", handlePostEditImport),
  compile("POST", "/api/v1/edit/projects/:projectId/generate", handlePostEditGenerate),
  compile("POST", "/api/v1/edit/projects/:projectId/agent", handlePostEditAgent),
  compile("GET", "/api/v1/edit/projects/:projectId/events", handleGetEditEvents),
  compile("POST", "/api/v1/edit/projects/:projectId/jobs", handlePostEditJobs),
  compile("GET", "/api/v1/edit/projects/:projectId/jobs/:jobId", handleGetEditJob),
  compile("POST", "/api/v1/edit/projects/:projectId/jobs/:jobId/cancel", handlePostEditJobCancel),
  compile("POST", "/api/v1/edit/projects/:projectId/export", handlePostEditExport),
  compile("GET", "/api/v1/edit/projects/:projectId/export/:jobId/file", handleGetEditExportFile),
  compile("POST", "/api/v1/edit/projects/:projectId/unplaced/:itemId/place", handlePostEditUnplacedPlace),
  compile("POST", "/api/v1/edit/projects/:projectId/unplaced/:itemId/discard", handlePostEditUnplacedDiscard),
  compile("POST", "/api/v1/edit/projects/:projectId/parity", handlePostEditParity),
  compile("GET", "/api/v1/settings", handleGetSettings),
  compile("POST", "/api/v1/settings", handlePostSettings),
  compile("GET", "/api/v1/usage", handleGetUsage),
  compile("GET", "/api/v1/chat", handleGetChat),
  compile("GET", "/api/v1/workspaces", handleGetWorkspaces),
  compile("POST", "/api/v1/workspaces", handlePostWorkspaces),
  compile("POST", "/api/v1/workspaces/:workspaceId/select", handleSelectWorkspace),
  compile("PATCH", "/api/v1/workspaces/:workspaceId", handlePatchWorkspace),
  compile("DELETE", "/api/v1/workspaces/:workspaceId", handleDeleteWorkspace),
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
  compile("GET", "/api/v1/videos/examples", handleGetVideoExamples),
  compile("GET", "/api/v1/videos/examples/:name/file", handleGetVideoExampleFile),
  compile("POST", "/api/v1/documents", handlePostDocuments),
  compile("POST", "/api/v1/documents/regenerate", handlePostDocumentsRegen),
  compile("POST", "/api/v1/documents/docx", handlePostDocumentsDocx),
  compile("POST", "/api/v1/presentations", handlePostPresentations),
  compile("POST", "/api/v1/presentations/regenerate", handlePostPresentationsRegen),
  compile("POST", "/api/v1/presentations/pptx", handlePostPresentationsPptx),
  compile("POST", "/api/v1/research", handlePostResearch),
  compile("POST", "/api/v1/research/stream", handlePostResearchStream),
  compile("POST", "/api/v1/finance", handlePostFinance),
  compile("POST", "/api/v1/finance/stream", handlePostFinanceStream),
  compile("POST", "/api/v1/finance/parse", handlePostFinanceParse),
  compile("POST", "/api/v1/finance/regenerate", handlePostFinanceRegen),
  compile("POST", "/api/v1/finance/docx", handlePostFinanceDocx),
  compile("POST", "/api/v1/market", handlePostMarket),
  compile("POST", "/api/v1/market/board", handlePostMarketBoard),
  compile("POST", "/api/v1/market/stream", handlePostMarketStream),
  compile("POST", "/api/v1/market/regenerate", handlePostMarketRegen),
  compile("POST", "/api/v1/market/docx", handlePostMarketDocx),
  compile("POST", "/api/v1/data", handlePostData),
  compile("POST", "/api/v1/data/stream", handlePostDataStream),
  compile("GET", "/api/v1/datasets", handleGetDatasets),
  compile("POST", "/api/v1/datasets", handlePostDatasets),
  compile("GET", "/api/v1/datasets/:datasetId", handleGetDataset),
  compile("DELETE", "/api/v1/datasets/:datasetId", handleDeleteDataset),
  compile("GET", "/api/v1/legal/playbooks", handleGetLegalPlaybooks),
  compile("GET", "/api/v1/legal/matters", handleGetLegalMatters),
  compile("POST", "/api/v1/legal/matters", handlePostLegalMatters),
  compile("GET", "/api/v1/legal/matters/:matterId", handleGetLegalMatter),
  compile("PATCH", "/api/v1/legal/matters/:matterId", handlePatchLegalMatter),
  compile("DELETE", "/api/v1/legal/matters/:matterId", handleDeleteLegalMatter),
  compile("POST", "/api/v1/legal/matters/:matterId/files", handlePostLegalMatterFile),
  compile("DELETE", "/api/v1/legal/matters/:matterId/files/:docId", handleDeleteLegalMatterFile),
  compile("POST", "/api/v1/legal/matters/:matterId/run/stream", handlePostLegalRunStream),
  compile("GET", "/api/v1/legal/matters/:matterId/runs/:runId", handleGetLegalRun),
  compile("POST", "/api/v1/prompts/enhance", handlePostEnhancePrompt),
  compile("GET", "/api/v1/artifacts", handleGetArtifacts),
  compile("GET", "/api/v1/artifacts/:artifactId", handleGetArtifact),
  compile("DELETE", "/api/v1/artifacts/:artifactId", handleDeleteArtifact),
  compile("GET", "/api/v1/artifacts/:artifactId/file", handleGetArtifactFile),
  compile("GET", "/api/v1/knowledge", handleGetKnowledge),
  compile("GET", "/api/v1/knowledge/context", handleGetKnowledgeContext),
  compile("GET", "/api/v1/knowledge/graph", handleGetKnowledgeGraph),
  compile("POST", "/api/v1/knowledge/verify", handlePostKnowledgeVerify),
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
