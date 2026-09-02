"use client";

import { useEffect, useState } from "react";
import { Link } from "@/lib/nav";
import { useRouter } from "@/lib/nav";
import { apiFetch } from "@/lib/api-client";

type Workspace = { id: string; name: string; slug: string };

type Props = {
  workspaceName: string;
  compact?: boolean;
};

export function WorkspaceSwitcher({ workspaceName, compact = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch("/api/v1/workspaces")
      .then((res) => res.json())
      .then((payload) => {
        setWorkspaces(payload.workspaces ?? []);
        setCurrentId(payload.currentWorkspaceId ?? null);
      });
  }, [workspaceName]);

  async function openWorkspace(id: string) {
    await apiFetch(`/api/v1/workspaces/${id}/select`, { method: "POST" });
    setOpen(false);
    router.push("/chat");
    router.refresh();
  }

  const triggerClass = compact
    ? "flex justify-center rounded-md px-2 py-2 text-xs font-medium text-ink hover:bg-mist"
    : "block w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm text-ink hover:bg-mist";

  return (
    <div className="relative" data-testid="workspaces-switcher">
      <button
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={workspaceName}
        aria-label={`Workspace: ${workspaceName}`}
        onClick={() => setOpen((was) => !was)}
      >
        {compact ? workspaceName.slice(0, 1) : workspaceName}
      </button>
      {open ? (
        <div
          className={`absolute z-20 rounded-md border border-mist bg-paper p-1 shadow-sm ${
            compact ? "bottom-0 left-full ml-1 w-48" : "bottom-full left-0 mb-1 w-full"
          }`}
          role="listbox"
        >
          {workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              role="option"
              aria-selected={workspace.id === currentId}
              className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-mist"
              onClick={() => void openWorkspace(workspace.id)}
              data-testid="open-workspace"
            >
              {workspace.name}
              {workspace.id === currentId ? " · current" : ""}
            </button>
          ))}
          <Link
            href="/workspaces"
            className="mt-1 block rounded-md px-2 py-1.5 text-sm text-navy hover:bg-mist"
            data-testid="workspace-new-link"
            onClick={() => setOpen(false)}
          >
            New workspace…
          </Link>
        </div>
      ) : null}
    </div>
  );
}
