import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";
import { WORKSPACE_COOKIE } from "@agentforge/core";

export { WORKSPACE_COOKIE };

export function selectedWorkspacePath(): string {
  return resolve(localDataDir(), "workspace-id.txt");
}

export function readSelectedWorkspaceId(): string | undefined {
  try {
    const raw = readFileSync(selectedWorkspacePath(), "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function writeSelectedWorkspaceId(id: string): void {
  mkdirSync(localDataDir(), { recursive: true });
  writeFileSync(selectedWorkspacePath(), `${id}\n`, "utf8");
}

export function workspaceCookie(id: string): { name: string; value: string; path: string } {
  return { name: WORKSPACE_COOKIE, value: id, path: "/" };
}

export function workspaceFileExists(): boolean {
  return existsSync(selectedWorkspacePath());
}
