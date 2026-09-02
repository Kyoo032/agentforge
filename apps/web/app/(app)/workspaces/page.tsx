"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_MODES, type ProductMode } from "@agentforge/core/product-modes";
import { WORKSPACE_TEMPLATES } from "@agentforge/core/templates";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  templatePack?: string | null;
  productModes?: ProductMode[];
};

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
  const [selectedModes, setSelectedModes] = useState<ProductMode[]>(["chat"]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModes, setEditModes] = useState<ProductMode[]>([]);

  async function reload() {
    const payload = await fetch("/api/v1/workspaces").then((res) => res.json());
    setWorkspaces(payload.workspaces ?? []);
    setCurrentId(payload.currentWorkspaceId ?? null);
  }

  useEffect(() => {
    void reload();
  }, []);

  function applyPreset(id: string | null) {
    setTemplatePack(id);
    if (!id) {
      setSelectedModes(["chat"]);
      return;
    }
    const preset = WORKSPACE_TEMPLATES.find((entry) => entry.id === id);
    setSelectedModes(preset ? [...preset.productModes] : ["chat"]);
  }

  function toggleMode(list: ProductMode[], id: ProductMode, setter: (next: ProductMode[]) => void) {
    if (id === "chat") {
      return;
    }
    setter(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const body: { name: string; templatePack?: string; productModes: ProductMode[] } = {
      name,
      productModes: selectedModes.includes("chat") ? selectedModes : ["chat", ...selectedModes],
    };
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
    applyPreset(null);
    router.push("/chat");
    router.refresh();
  }

  async function openWorkspace(id: string) {
    await fetch(`/api/v1/workspaces/${id}/select`, { method: "POST" });
    router.push("/chat");
    router.refresh();
  }

  async function saveModes(id: string) {
    setError(null);
    const modes = editModes.includes("chat") ? editModes : ["chat", ...editModes];
    const saved = await fetch(`/api/v1/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productModes: modes }),
    }).then((res) => res.json());
    if (saved.error) {
      setError(saved.error.message ?? "Could not update modes");
      return;
    }
    setEditingId(null);
    await reload();
    if (id === currentId) {
      router.refresh();
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink">Workspaces</h1>
      <p className="mt-2 text-ink/60">
        Folders on this machine. Pick a preset or choose the tabs you need for this desk. You own all of them here —
        nothing to join.
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
              onClick={() => applyPreset(null)}
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
                  onClick={() => applyPreset(template.id)}
                >
                  {template.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium text-ink">Modes</legend>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="workspace-mode-picker">
            {PRODUCT_MODES.map((mode) => {
              const on = selectedModes.includes(mode.id);
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={`${chipBase} ${on ? chipOn : chipOff}`}
                  data-testid={`workspace-mode-${mode.id}`}
                  aria-pressed={on}
                  disabled={mode.id === "chat"}
                  onClick={() => toggleMode(selectedModes, mode.id, setSelectedModes)}
                >
                  {mode.label}
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
          const modes = workspace.productModes ?? [];
          return (
            <li
              key={workspace.id}
              className="rounded-md border border-mist bg-paper px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">
                    {workspace.name}
                    {packLabel ? (
                      <span className="ml-2 text-xs font-normal text-ink/50">{packLabel}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-ink/50">
                    {workspace.id === currentId ? "Current · " : ""}
                    {modes.map((id) => PRODUCT_MODES.find((mode) => mode.id === id)?.label ?? id).join(", ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm text-navy underline"
                    onClick={() => {
                      setEditingId(editingId === workspace.id ? null : workspace.id);
                      setEditModes(modes.length ? [...modes] : ["chat"]);
                    }}
                    data-testid="edit-workspace-modes"
                  >
                    Modes
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm text-navy underline"
                    onClick={() => void openWorkspace(workspace.id)}
                    data-testid="open-workspace"
                  >
                    Open
                  </button>
                </div>
              </div>
              {editingId === workspace.id ? (
                <div className="mt-3 flex flex-wrap gap-2" data-testid="workspace-edit-modes">
                  {PRODUCT_MODES.map((mode) => {
                    const on = editModes.includes(mode.id);
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        className={`${chipBase} ${on ? chipOn : chipOff}`}
                        disabled={mode.id === "chat"}
                        onClick={() => toggleMode(editModes, mode.id, setEditModes)}
                      >
                        {mode.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="rounded-md bg-navy px-3 py-1.5 text-sm text-white"
                    data-testid="save-workspace-modes"
                    onClick={() => void saveModes(workspace.id)}
                  >
                    Save modes
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
