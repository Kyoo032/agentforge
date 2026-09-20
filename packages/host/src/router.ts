import { isServerMode } from "@agentforge/core";
import { hostAuthRoutes, hostSessionStore, isSessionExemptPath, requireSessionFor } from "./auth";
import type { SessionStore } from "./auth";
import { jsonError, jsonOk } from "./errors";
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
import {
  handleDeleteChannel,
  handleDeleteTelegramBot,
  handleGetChannel,
  handleGetChannelMessages,
  handleGetChannels,
  handleGetTelegramBot,
  handlePostChannelSend,
  handlePostChannels,
  handlePostTelegramBot,
  handlePostTelegramPoll,
} from "./handlers/channels";
import { handleGetChat } from "./handlers/chat";
import { handleGetComponents, handlePostComponentInstallStream } from "./handlers/components";
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
import { handlePostFinanceExport } from "./handlers/finance-export";
import { handlePostFinanceImport } from "./handlers/finance-import";
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
  handlePostKnowledgeReindex,
  handlePostKnowledgeSource,
  handlePostKnowledgeSourceReindex,
  handlePostKnowledgeSourceUrl,
  handlePostKnowledgeVerify,
  handlePutKnowledgeModels,
  handlePutKnowledgeSoul,
  handlePutKnowledgeBackend,
  handlePostKnowledgeBackendReindex,
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
import {
  handleApplyLocale,
  handleCancelReset,
  handleGatewayCheck,
  handleGetSettings,
  handlePostSettings,
  handleResetApp,
} from "./handlers/settings";
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
import type { HostHandler, HostRequest, HostResult, HostSession } from "./types";

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
  // Phase 2, hosted only: the browser session. Exempt from the session gate below, by definition.
  compile("POST", "/api/v1/auth/login", (req) => hostAuthRoutes().handleLogin(req)),
  compile("POST", "/api/v1/auth/logout", (req) => hostAuthRoutes().handleLogout(req)),
  compile("GET", "/api/v1/auth/session", (req) => hostAuthRoutes().handleSession(req)),
  compile("POST", "/api/v1/auth/refresh", (req) => hostAuthRoutes().handleRefresh(req)),
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
  compile("POST", "/api/v1/settings/apply-locale", handleApplyLocale),
  compile("POST", "/api/v1/settings/gateway/check", handleGatewayCheck),
  compile("POST", "/api/v1/settings/reset", handleResetApp),
  compile("DELETE", "/api/v1/settings/reset", handleCancelReset),
  compile("GET", "/api/v1/usage", handleGetUsage),
  // Deliberately NOT behind `requireGatewayAllowed()`: a component installs during onboarding,
  // before a key exists, and never touches the gateway. See handlers/components.ts.
  compile("GET", "/api/v1/components", handleGetComponents),
  compile("POST", "/api/v1/components/install/stream", handlePostComponentInstallStream),
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
  compile("POST", "/api/v1/finance/export", handlePostFinanceExport),
  compile("POST", "/api/v1/finance/import", handlePostFinanceImport),
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
  // Channels (docs/internal/telegram-channels-plan.md). The two-segment `telegram/*` paths sit
  // above `:channelId` in the table, and cannot be shadowed by it either way: a route pattern
  // matches one path segment.
  compile("GET", "/api/v1/channels/telegram/bot", handleGetTelegramBot),
  compile("POST", "/api/v1/channels/telegram/bot", (req) => handlePostTelegramBot(req)),
  compile("DELETE", "/api/v1/channels/telegram/bot", handleDeleteTelegramBot),
  compile("POST", "/api/v1/channels/telegram/poll", (req) => handlePostTelegramPoll(req)),
  compile("GET", "/api/v1/channels", handleGetChannels),
  compile("POST", "/api/v1/channels", (req) => handlePostChannels(req)),
  compile("GET", "/api/v1/channels/:channelId", handleGetChannel),
  compile("DELETE", "/api/v1/channels/:channelId", handleDeleteChannel),
  compile("GET", "/api/v1/channels/:channelId/messages", handleGetChannelMessages),
  compile("POST", "/api/v1/channels/:channelId/send", (req) => handlePostChannelSend(req)),
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
  compile("PUT", "/api/v1/knowledge/backend", handlePutKnowledgeBackend),
  compile("POST", "/api/v1/knowledge/backend/reindex", handlePostKnowledgeBackendReindex),
  compile("POST", "/api/v1/knowledge/verify", handlePostKnowledgeVerify),
  compile("PUT", "/api/v1/knowledge/models", handlePutKnowledgeModels),
  compile("POST", "/api/v1/knowledge/map", handlePostKnowledgeMap),
  compile("PUT", "/api/v1/knowledge/soul", handlePutKnowledgeSoul),
  compile("POST", "/api/v1/knowledge/memories", handlePostKnowledgeMemory),
  compile("DELETE", "/api/v1/knowledge/memories/:memoryId", handleDeleteKnowledgeMemory),
  compile("POST", "/api/v1/knowledge/sources", handlePostKnowledgeSource),
  compile("POST", "/api/v1/knowledge/sources/url", handlePostKnowledgeSourceUrl),
  compile("POST", "/api/v1/knowledge/sources/:sourceId/reindex", handlePostKnowledgeSourceReindex),
  compile("POST", "/api/v1/knowledge/reindex", handlePostKnowledgeReindex),
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

const API_PREFIX = "/api/";

/**
 * Injected so a test never has to touch `process.env` or the real database
 * (docs/internal/web-security-spec.md row T1). Defaults are the hosted server's.
 */
export type DispatchOptions = {
  serverMode?: boolean;
  sessionStore?: SessionStore;
  now?: () => number;
};

type GateVerdict =
  | { readonly ok: true; readonly session?: HostSession }
  | { readonly ok: false; readonly result: HostResult };

/**
 * The hosted session gate: **every** `/api` call needs a verified session, whatever the method.
 * A read is not safe here — a GET returns settings, threads, artifact bytes and event streams — so
 * only `isSessionExemptPath` decides, never the method on its own.
 *
 * Off server mode this is never reached, so the desktop IPC path and webdev behave exactly as they
 * did before Phase 2: neither of them has a session to present.
 */
async function gate(
  request: HostRequest,
  method: string,
  path: string,
  options: DispatchOptions,
): Promise<GateVerdict> {
  if (!path.startsWith(API_PREFIX) || isSessionExemptPath(method, path)) {
    return { ok: true };
  }
  try {
    const session = await requireSessionFor(request, {
      store: options.sessionStore ?? hostSessionStore(),
      now: options.now,
    });
    return {
      ok: true,
      session: {
        id: session.id,
        tenantId: session.tenantId,
        orgId: session.orgId,
        userId: session.userId,
      },
    };
  } catch (error) {
    // Answered before the route table is consulted: an unauthenticated caller learns nothing about
    // which paths exist.
    return { ok: false, result: jsonError(error) };
  }
}

export async function dispatch(request: HostRequest, options: DispatchOptions = {}): Promise<HostResult> {
  const method = request.method.toUpperCase();
  const path = request.path.replace(/\/+$/, "") || "/";
  // Read per request, never once at module load: a process that is told it is a server after this
  // module was imported (and every test that stubs the variable) still gets the gate.
  const serverMode = options.serverMode ?? isServerMode();
  let session: HostSession | undefined;
  if (serverMode) {
    const verdict = await gate(request, method, path, options);
    if (!verdict.ok) {
      return verdict.result;
    }
    session = verdict.session;
  }
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
    // A new request object every time: the caller's own is never written to. `session` is dropped
    // first and only ever re-added from the gate above, so an invented one can never reach a
    // handler as identity.
    const { session: _invented, ...rest } = request;
    return route.handler(session ? { ...rest, params, path, session } : { ...rest, params, path });
  }
  return jsonOk({ error: { code: "not_found", message: "Not found" } }, 404);
}
