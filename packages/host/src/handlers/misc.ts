import {
  defaultAgentPack,
  hostCapabilities,
  listToolRoutes,
  listTools,
  resolvedGatewayBaseUrl,
  resolvedGatewayName,
  resolvedProductName,
} from "@agentforge/core";
import { legalAgentPacks } from "@agentforge/legal";
import { marketingAgentPacks } from "@agentforge/marketing";
import { agentPacks } from "@agentforge/university";
import { db, organizationMembers, organizations, workspaces } from "@agentforge/db";
import { eq } from "drizzle-orm";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { ensureToolsRegistered } from "../register-tools";
import { loadSettings } from "../settings-store";
import { localePayload } from "../locale-boot";

export async function handleGetTools(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    ensureToolsRegistered();
    const routes = listToolRoutes(loadSettings(tenant));
    return jsonOk({
      tools: listTools().map((tool) => ({
        key: tool.key,
        name: tool.name,
        description: tool.description,
        capability: tool.capability,
        pack: tool.pack,
        ready: !tool.capability || Boolean(routes[tool.capability]?.ready),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetContext(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, tenant.organizationId))
      .limit(1);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, tenant.workspaceId)).limit(1);
    return jsonOk({ tenant, organization, workspace });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetTemplates(request: HostRequest): Promise<HostResult> {
  try {
    await getTenant(request);
    return jsonOk({
      packs: [defaultAgentPack, ...agentPacks, ...marketingAgentPacks, ...legalAgentPacks],
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetOrganizations(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, tenant.organizationId))
      .limit(1);
    const members = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, tenant.organizationId));
    return jsonOk({ organization, members });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * The cheapest GET on the API, and since Phase 8 the one place the renderer learns what this
 * deployment can do.
 *
 * `capabilities` is the migration plan's §4 shape ("resolved once at boot and read by both the
 * host and the renderer"), and it belongs here rather than on a route of its own for three
 * reasons: this is one of the two ungated GETs (`../auth/routes.ts`), so the onboarding screen can
 * read it before anybody has signed in; it is what the renderer already fetches first, to prime
 * the CSRF cookie and the brand; and both transports answer it identically, so the packaged
 * desktop reads its own capabilities through the same code path as a browser.
 *
 * Nothing in it is per tenant, per user or per plan — every flag is a fact about the target, which
 * is what makes it safe to hand an anonymous caller. A plan's allowance stays on
 * `GET /api/v1/billing/plan`, behind the session.
 */
export async function handlePing(): Promise<HostResult> {
  return jsonOk({
    ok: true,
    transport: "host",
    productName: resolvedProductName(),
    gatewayName: resolvedGatewayName(),
    gatewayBaseUrl: resolvedGatewayBaseUrl(),
    capabilities: hostCapabilities(),
    ...localePayload(),
  });
}
