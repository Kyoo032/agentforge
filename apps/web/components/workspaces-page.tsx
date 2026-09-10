"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/lib/nav";
import { PRODUCT_MODES, type ProductMode } from "@agentforge/core/product-modes";
import { WORKSPACE_TEMPLATES } from "@agentforge/core/templates";
import { apiFetch } from "@/lib/api-client";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  templatePack?: string | null;
  productModes?: ProductMode[];
  protected?: boolean;
};

const chipBase = "rounded-md border px-3 py-1.5 text-sm transition-colors";
const chipOn = "border-accent bg-accent text-white";
const chipOff = "border-mist bg-paper text-ink hover:bg-mist";

function templateLabel(id: string | null | undefined): string | null {
  if (!id) {
    return null;
  }
  return WORKSPACE_TEMPLATES.find((entry) => entry.id === id)?.label ?? id;
}

function sameModes(a: ProductMode[], b: ProductMode[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = new Set(a);
  return b.every((id) => left.has(id));
}

function withChat(list: ProductMode[]): ProductMode[] {
  return list.includes("chat") ? list : ["chat", ...list];
}

export function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [templatePack, setTemplatePack] = useState<string | null>(null);
  const [selectedModes, setSelectedModes] = useState<ProductMode[]>(["chat"]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editModes, setEditModes] = useState<ProductMode[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  async function reload() {
    const payload = await apiFetch("/api/v1/workspaces").then((res) => res.json());
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

  function openCreate() {
    setError(null);
    setEditingId(null);
    setDeletingId(null);
    applyPreset(null);
    setName("");
    setCreating(true);
  }

  function closeCreate() {
    setCreating(false);
    applyPreset(null);
    setName("");
  }

  function openEditor(workspace: Workspace) {
    const modes = workspace.productModes ?? [];
    setError(null);
    setCreating(false);
    setDeletingId(null);
    if (editingId === workspace.id) {
      setEditingId(null);
      return;
    }
    setEditingId(workspace.id);
    setEditName(workspace.name);
    setEditModes(modes.length ? [...modes] : ["chat"]);
  }

  function openDelete(workspace: Workspace) {
    if (workspace.protected || workspace.slug === "home") {
      return;
    }
    setError(null);
    setCreating(false);
    setEditingId(null);
    setDeletingId(deletingId === workspace.id ? null : workspace.id);
    setDeleteConfirm("");
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const body: { name: string; templatePack?: string; productModes: ProductMode[] } = {
      name,
      productModes: withChat(selectedModes),
    };
    if (templatePack) {
      body.templatePack = templatePack;
    }
    const created = await apiFetch("/api/v1/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((res) => res.json());
    if (created.error) {
      setError(created.error.message ?? created.error.code ?? "Could not create workspace");
      return;
    }
    closeCreate();
    router.push("/chat");
    router.refresh();
  }

  async function openWorkspace(id: string) {
    await apiFetch(`/api/v1/workspaces/${id}/select`, { method: "POST" });
    router.push("/chat");
    router.refresh();
  }

  async function saveDesk(id: string, originalName: string, originalModes: ProductMode[]) {
    setError(null);
    const trimmed = editName.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    const modes = withChat(editModes);
    const saved = await apiFetch(`/api/v1/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, productModes: modes }),
    }).then((res) => res.json());
    if (saved.error) {
      setError(saved.error.message ?? "Could not update workspace");
      return;
    }
    setEditingId(null);
    await reload();
    if (id === currentId && (trimmed !== originalName || !sameModes(modes, originalModes))) {
      router.refresh();
    }
  }

  async function deleteDesk(workspace: Workspace) {
    setError(null);
    if (workspace.protected || workspace.slug === "home") {
      setError("The Default desk cannot be deleted");
      return;
    }
    if (deleteConfirm.trim() !== workspace.name) {
      setError("Type the desk name to confirm deletion");
      return;
    }
    const deleted = await apiFetch(`/api/v1/workspaces/${workspace.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: deleteConfirm.trim() }),
    }).then((res) => res.json());
    if (deleted.error) {
      setError(deleted.error.message ?? "Could not delete workspace");
      return;
    }
    setDeletingId(null);
    setDeleteConfirm("");
    await reload();
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 text-ink">
      <h1 className="text-3xl font-semibold text-ink">Workspaces</h1>
      <p className="mt-2 text-ink/60">
        Folders on this machine. Each desk has its own gateway key, Settings, and Knowledge Base — switching does not
        share them. You own all of them here — nothing to join.
      </p>
      {creating ? (
        <form
          onSubmit={(event) => void createWorkspace(event)}
          className="mt-8 space-y-4 rounded-xl border border-mist bg-paper p-4"
          data-testid="workspace-create-form"
        >
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
          <div className="flex flex-wrap gap-3">
            <input
              className="min-w-[12rem] flex-1 rounded-md border border-mist bg-paper px-3 py-2 text-ink"
              placeholder="New workspace name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              data-testid="workspace-name"
            />
            <button type="submit" className="rounded-md bg-navy px-4 py-2 text-white" data-testid="create-workspace">
              Create
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm text-ink/70 underline"
              data-testid="cancel-create-workspace"
              onClick={closeCreate}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="mt-8 rounded-full bg-navy px-3 py-1.5 text-sm text-white"
          data-testid="create-new-workspace"
          onClick={openCreate}
        >
          Create new workspace
        </button>
      )}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <ul className="mt-8 space-y-2 rounded-xl border border-mist bg-paper p-3" data-testid="workspace-list">
        {workspaces.map((workspace) => {
          const packLabel = templateLabel(workspace.templatePack);
          const modes = workspace.productModes ?? [];
          const dirty = editName.trim() !== workspace.name || !sameModes(withChat(editModes), withChat(modes));
          return (
            <li key={workspace.id} className="rounded-md border border-mist bg-paper px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">
                    {workspace.name}
                    {packLabel ? <span className="ml-2 text-xs font-normal text-ink/50">{packLabel}</span> : null}
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
                    onClick={() => openEditor(workspace)}
                    data-testid="edit-workspace-modes"
                  >
                    Edit
                  </button>
                  {workspace.protected || workspace.slug === "home" ? null : (
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-sm text-red-700 underline"
                      onClick={() => openDelete(workspace)}
                      data-testid="delete-workspace"
                    >
                      Delete
                    </button>
                  )}
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
                <div className="mt-3 space-y-3">
                  <label className="block text-sm font-medium text-ink">
                    Name
                    <input
                      className="mt-1 w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      data-testid="workspace-edit-name"
                    />
                  </label>
                  <div>
                    <p className="text-sm font-medium text-ink">Modes</p>
                    <div className="mt-2 flex flex-wrap gap-2" data-testid="workspace-edit-modes">
                      {PRODUCT_MODES.map((mode) => {
                        const on = editModes.includes(mode.id);
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            className={`${chipBase} ${on ? chipOn : chipOff}`}
                            data-testid={`workspace-edit-mode-${mode.id}`}
                            disabled={mode.id === "chat"}
                            aria-pressed={on}
                            onClick={() => toggleMode(editModes, mode.id, setEditModes)}
                          >
                            {mode.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-navy px-4 py-2 text-sm text-white disabled:opacity-50"
                      data-testid="save-workspace-modes"
                      disabled={!dirty || !editName.trim()}
                      onClick={() => void saveDesk(workspace.id, workspace.name, modes)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-2 text-sm text-ink/70 underline"
                      data-testid="cancel-workspace-modes"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {deletingId === workspace.id ? (
                <div className="mt-3 space-y-3 rounded-md border border-red-200 bg-red-50/60 p-3" data-testid="delete-workspace-confirm">
                  <p className="text-sm text-ink">
                    This removes the desk, its chats, Knowledge Base, and saved key from this machine. Type{" "}
                    <span className="font-medium">{workspace.name}</span> to confirm.
                  </p>
                  <input
                    className="w-full rounded-md border border-mist bg-paper px-3 py-2 text-ink"
                    value={deleteConfirm}
                    onChange={(event) => setDeleteConfirm(event.target.value)}
                    placeholder={workspace.name}
                    data-testid="delete-workspace-confirm-name"
                    autoComplete="off"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-full bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      data-testid="delete-workspace-confirm-submit"
                      disabled={deleteConfirm.trim() !== workspace.name}
                      onClick={() => void deleteDesk(workspace)}
                    >
                      Delete desk
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-2 text-sm text-ink/70 underline"
                      data-testid="delete-workspace-cancel"
                      onClick={() => {
                        setDeletingId(null);
                        setDeleteConfirm("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
