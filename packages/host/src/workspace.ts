import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";
import { isServerMode, WORKSPACE_COOKIE } from "@agentforge/core";

export { WORKSPACE_COOKIE };

/**
 * `workspace-id.txt` is **desktop and webdev only** (Phase 3 lane C, spec §3d).
 *
 * It names one desk for the whole machine, which is exactly right for an installed app with one
 * owner and exactly wrong for a server: the last browser to select a desk would repoint every
 * deskless read for every other tenant on the box. Guarding the two accessors rather than their
 * callers keeps the rule in one place — `handlers/workspaces.ts` writes it in three of them.
 *
 * In server mode the read reports "no machine selection" and the write does nothing, so a hosted
 * request falls back to the session's desks and nothing else.
 */
export function selectedWorkspacePath(): string {
  return resolve(localDataDir(), "workspace-id.txt");
}

export function readSelectedWorkspaceId(): string | undefined {
  if (isServerMode()) {
    return undefined;
  }
  try {
    const raw = readFileSync(selectedWorkspacePath(), "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function writeSelectedWorkspaceId(id: string): void {
  if (isServerMode()) {
    return;
  }
  mkdirSync(localDataDir(), { recursive: true });
  writeFileSync(selectedWorkspacePath(), `${id}\n`, "utf8");
}

export function workspaceCookie(id: string): { name: string; value: string; path: string } {
  return { name: WORKSPACE_COOKIE, value: id, path: "/" };
}

export function workspaceFileExists(): boolean {
  return !isServerMode() && existsSync(selectedWorkspacePath());
}

/**
 * Clears the stale `WORKSPACE_COOKIE` that named a desk the caller's tenant does not own, so the
 * next request resolves the session's home desk instead of 404ing again (spec §3d).
 */
export function clearedWorkspaceCookie(): { name: string; value: string; path: string; maxAge: number } {
  return { name: WORKSPACE_COOKIE, value: "", path: "/", maxAge: 0 };
}
