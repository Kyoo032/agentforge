import type { TenantContext } from "@agentforge/core";
import { clearWorkspaceModelId, getWorkspaceBinding } from "../../backend-store";
import { loadSettings, saveSettings } from "../../../settings-store";
import type { WeKnoraClient } from "./client";
import { forgetVerifiedBinding } from "./bootstrap";
import { WEKNORA_SETTINGS_WORKSPACE } from "./secrets";

/**
 * Taking the gateway key back out of the sidecar's database.
 *
 * The model row we create carries the desk's gateway key, encrypted at rest in a third-party
 * SQLite file that outlives the flag that put it there. Deselecting WeKnora, or changing the key,
 * has to reach in and delete that row — otherwise "I turned it off" and "I rotated the key" both
 * leave the old secret usable by anything that can read that file.
 *
 * Two properties this must have. It never throws: revocation runs from a settings save and a flag
 * flip, and neither may fail because a sidecar was down. And it is *durable*: a sidecar that is not
 * running still holds the row, so the id is queued in the local settings slice and replayed on the
 * next connect. Forgetting it locally would be the worst of both worlds — the key gone from our
 * side, still live on theirs, with nothing left that knows to remove it.
 */

/** Ids are opaque strings from the sidecar; a comma is not in any of them. */
const SEPARATOR = ",";

function queued(): string[] {
  const raw = loadSettings(WEKNORA_SETTINGS_WORKSPACE).weknoraRevokedModelIds ?? "";
  return raw
    .split(SEPARATOR)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function writeQueue(ids: string[]): void {
  try {
    saveSettings({ weknoraRevokedModelIds: [...new Set(ids)].join(SEPARATOR) }, WEKNORA_SETTINGS_WORKSPACE);
  } catch (error) {
    console.warn(`knowledge-weknora: revocation queue not saved (${short(error)})`);
  }
}

/** Remember a model row that still has to be deleted. */
export function queueModelRevocation(modelId: string): void {
  if (!modelId.trim()) {
    return;
  }
  writeQueue([...queued(), modelId.trim()]);
}

/** Test/reporting hook: what is still owed. */
export function pendingRevocations(): string[] {
  return queued();
}

/**
 * Delete every queued model row through `client`. Rows that are already gone (404) count as done;
 * anything else stays queued for the next attempt. Never throws.
 */
export async function flushModelRevocations(client: WeKnoraClient): Promise<number> {
  const ids = queued();
  if (ids.length === 0) {
    return 0;
  }
  const remaining: string[] = [];
  let deleted = 0;
  for (const id of ids) {
    try {
      await client.deleteModel(id);
      deleted += 1;
    } catch (error) {
      remaining.push(id);
      console.warn(`knowledge-weknora: model ${id} not revoked yet (${short(error)})`);
    }
  }
  writeQueue(remaining);
  return deleted;
}

/**
 * Revoke this desk's backend-side model row: forget it locally *and* queue its deletion.
 *
 * The local half is unconditional and immediate — the cached `model_id` is what a later bootstrap
 * would otherwise reuse — and the remote half is attempted by `attempt` when one is given (a live
 * connection), or left queued when there is not.
 */
export async function revokeWorkspaceModel(
  tenant: TenantContext,
  attempt?: (modelId: string) => Promise<void>,
): Promise<void> {
  const modelId = getWorkspaceBinding(tenant, "weknora")?.modelId ?? null;
  clearWorkspaceModelId(tenant);
  forgetVerifiedBinding(tenant.workspaceId);
  if (!modelId) {
    return;
  }
  if (!attempt) {
    queueModelRevocation(modelId);
    return;
  }
  try {
    await attempt(modelId);
  } catch (error) {
    queueModelRevocation(modelId);
    console.warn(`knowledge-weknora: model ${modelId} revocation queued (${short(error)})`);
  }
}

function short(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "error";
}
