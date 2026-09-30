import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Every mode id, written out. A fresh Personal desk starts with only Chat, Research, Images, Videos
 * and Presentation (`FIRST_RUN_MODES`, owner decision 2026-09-29), and these specs drive Documents,
 * Finance, Data, Market and Edit, so they turn the rest on the way an owner does: by editing the
 * Default desk's modes, which is what Workspaces' Edit sends.
 *
 * Written out rather than imported from `@agentforge/core`, so a mode added to the catalog later
 * does not silently join a spec that never drives it.
 */
export const EVERY_MODE = [
  "chat",
  "documents",
  "research",
  "finance",
  "data",
  "market",
  "legal",
  "meeting",
  "images",
  "videos",
  "music",
  "edit",
  "presentations",
  "education",
];

/** Select the Default desk and give it every mode. Idempotent; a missing Origin header is allowed on loopback. */
export async function showEveryMode(request: APIRequestContext): Promise<void> {
  const listed = await request.get("/api/v1/workspaces");
  expect(listed.ok()).toBe(true);
  const body = (await listed.json()) as { workspaces: Array<{ id: string; slug: string }> };
  const homeId = body.workspaces.find((desk) => desk.slug === "home")?.id;
  if (!homeId) {
    throw new Error("no Default desk to give every mode");
  }
  const selected = await request.post(`/api/v1/workspaces/${homeId}/select`, { data: {} });
  expect(selected.ok()).toBe(true);
  const saved = await request.patch(`/api/v1/workspaces/${homeId}`, { data: { productModes: EVERY_MODE } });
  expect(saved.ok()).toBe(true);
}
