"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WORKSPACE_TEMPLATES } from "@agentforge/core/templates";

type Workspace = { id: string; name: string; slug: string; templatePack?: string | null };

const chipBase = "rounded-full border px-3 py-1.5 text-sm transition-colors";
const chipOn = "border-navy bg-navy text-white";
const chipOff = "border-mist bg-paper text-ink hover:bg-mist";

function templateLabel(id: string | null | undefined): string | null {
  if (!id) {
    return null;
  }
  return WORKSPACE_TEMPLATES.find((entry) => entry.id === id)?.label ?? id;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [templatePack, setTemplatePack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const payload = await fetch("/api/v1/workspaces").then((res) => res.json());
    setWorkspaces(payload.workspaces ?? []);
    setCurrentId(payload.currentWorkspaceId ?? null);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const body: { name: string; templatePack?: string } = { name };
    if (templatePack) {
      body.templatePack = templatePack;
    }
    const created = await fetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((res) => res.json());
    if (created.error) {
      setError(created.error.message ?? created.error.code ?? "Could not create workspace");
      return;
    }
    setName("");
    setTemplatePack(null);
    router.push("/agents");
    router.refresh();
  }

  async function openWorkspace(id: string) {
    await fetch(`/api/v1/workspaces/${id}/select`, { method: "POST" });
    router.push("/agents");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink">Workspaces</h1>
      <p className="mt-2 text-ink/60">
        Folders on this machine. Each workspace has its own agents and chats. You own all of them here — nothing to
        join.
      </p>
      <form onSubmit={(event) => void createWorkspace(event)} className="mt-8 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-ink">Template (optional)</legend>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="workspace-template-picker">
            <button
              type="button"
              className={`${chipBase} ${templatePack === null ? chipOn : chipOff}`}
              data-testid="workspace-template-blank"
              aria-pressed={templatePack === null}
              data-selected={templatePack === null ? "true" : "false"}
              onClick={() => setTemplatePack(null)}
            >
              Blank
            </button>
            {WORKSPACE_TEMPLATES.map((template) => {
              const selected = templatePack === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  className={`${chipBase} ${selected ? chipOn : chipOff}`}
                  data-testid={`workspace-template-${template.id}`}
                  aria-pressed={selected}
                  data-selected={selected ? "true" : "false"}
                  title={template.description}
                  onClick={() => setTemplatePack(template.id)}
                >
                  {template.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex gap-3">
          <input
            className="flex-1 rounded-md border border-mist bg-paper px-3 py-2 text-ink"
            placeholder="New workspace name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            data-testid="workspace-name"
          />
          <button
            type="submit"
            className="rounded-md bg-navy px-4 py-2 text-white"
            data-testid="create-workspace"
          >
            Create
          </button>
        </div>
      </form>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-8 space-y-2 rounded-xl border border-mist bg-paper p-3" data-testid="workspace-list">
        {workspaces.map((workspace) => {
          const packLabel = templateLabel(workspace.templatePack);
          return (
            <li
              key={workspace.id}
              className="flex items-center justify-between rounded-md border border-mist bg-paper px-4 py-3"
            >
              <div>
                <p className="font-medium text-ink">
                  {workspace.name}
                  {packLabel ? (
                    <span className="ml-2 text-xs font-normal text-ink/50">{packLabel}</span>
                  ) : null}
                </p>
                {workspace.id === currentId ? <p className="text-xs text-ink/50">Current</p> : null}
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm text-navy underline"
                onClick={() => void openWorkspace(workspace.id)}
                data-testid="open-workspace"
              >
                Open
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
