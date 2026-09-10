import { createContext, useContext } from "react";
import { HOME_WORKSPACE_NAME } from "@agentforge/core/local-owner";

export type WorkspaceScopeValue = {
  id: string | null;
  name: string;
};

export const WorkspaceScope = createContext<WorkspaceScopeValue>({
  id: null,
  name: HOME_WORKSPACE_NAME,
});

export function useWorkspaceScope(): WorkspaceScopeValue {
  return useContext(WorkspaceScope);
}
