import type { TenantContext } from "@agentforge/core";
import { dropSourceIds, type KnowledgeMap } from "@agentforge/core";
import { sql } from "@agentforge/db";
import { log } from "./log";

/**
 * The saved map is a claim about coverage. Deleting a source has to take that id
 * out of the claim. Graph prune already drops the node; this is the map blob.
 * A row that is not a saved map (`{}` while the first map is running) is left alone.
 */

function isSavedMap(value: unknown): value is KnowledgeMap {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as { topics?: unknown }).topics);
}

export function forgetSourcesOnMap(tenant: TenantContext, sourceIds: readonly string[]): void {
  if (sourceIds.length === 0) {
    return;
  }
  try {
    const row = sql.prepare("SELECT payload FROM knowledge_maps WHERE workspace_id = ?").get(tenant.workspaceId) as
      | { payload: string }
      | undefined;
    if (!row) {
      return;
    }
    const parsed: unknown = JSON.parse(row.payload);
    if (!isSavedMap(parsed)) {
      return;
    }
    const next = dropSourceIds(parsed, new Set(sourceIds));
    if (next === parsed) {
      return;
    }
    sql.prepare("UPDATE knowledge_maps SET payload = ? WHERE workspace_id = ?").run(
      JSON.stringify(next),
      tenant.workspaceId,
    );
  } catch (error) {
    log.warn("knowledge_map_source_not_forgotten", {
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
  }
}
