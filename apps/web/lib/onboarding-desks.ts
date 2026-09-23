/**
 * The way off the key screen when the install has more than one desk.
 *
 * Keys are per desk and the gate is derived from the selected desk's key, so a desk with no key
 * (one made before new desks inherited the key, or one whose own key was cleared) closes the gate
 * and the app shows only the key form. That form replaces the whole shell, rail and desk switcher
 * included, so without this the only exit from a keyless desk was pasting a key into it.
 *
 * Nothing here decides anything: selecting a desk is the host's `POST /select`, and the gate that
 * comes back is the host's answer for that desk, read through the same parser as at boot.
 */
import { apiFetch } from "./api-client";
import { parseGatewayGate, type GatewayGatePayload } from "./gateway-gate";

export type OnboardingDesk = { id: string; name: string };

/** Every desk except the current one, from a `GET /api/v1/workspaces` body. Malformed rows are dropped. */
export function otherDesks(payload: unknown): OnboardingDesk[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const record = payload as { workspaces?: unknown; currentWorkspaceId?: unknown };
  if (!Array.isArray(record.workspaces)) {
    return [];
  }
  const current = typeof record.currentWorkspaceId === "string" ? record.currentWorkspaceId : null;
  const desks: OnboardingDesk[] = [];
  for (const row of record.workspaces) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const { id, name } = row as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !id || typeof name !== "string" || id === current) {
      continue;
    }
    desks.push({ id, name });
  }
  return desks;
}

/** The other desks on this install; an empty list when the host cannot be asked. */
export async function fetchOtherDesks(): Promise<OnboardingDesk[]> {
  try {
    const res = await apiFetch("/api/v1/workspaces");
    if (!res.ok) {
      return [];
    }
    return otherDesks(await res.json().catch(() => null));
  } catch {
    return [];
  }
}

/**
 * Select `id` on the host, then ask the host for that desk's gate.
 *
 * Throws when the select is refused or the host cannot be reached, so the caller can say so; a gate
 * the host did not report comes back as `null`, which `resolveGate` already knows how to read.
 */
export async function openDesk(id: string): Promise<GatewayGatePayload | null> {
  const selected = await apiFetch(`/api/v1/workspaces/${encodeURIComponent(id)}/select`, { method: "POST" });
  if (!selected.ok) {
    throw new Error(`select_failed_${selected.status}`);
  }
  const res = await apiFetch("/api/v1/settings");
  const payload = (await res.json().catch(() => null)) as { gateway?: unknown } | null;
  return parseGatewayGate(payload?.gateway);
}
