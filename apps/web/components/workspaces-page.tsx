"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/lib/nav";
import { PRODUCT_MODES, type ProductMode } from "@agentforge/core/product-modes";
import { WORKSPACE_TEMPLATES } from "@agentforge/core/templates";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  templatePack?: string | null;
  productModes?: ProductMode[];
  protected?: boolean;
};

const chipBase = "rounded-md border px-3 py-1.5 text-sm transition-colors";
const chipOn = "border-[var(--accent)] bg-[var(--accent)] text-[var(--surface)]";
const chipOff = "border-[var(--line)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--line)]";

function templateLabel(id: string | null | undefined): string | null {
  if (!id) {
    return null;
  }
  const fallback = WORKSPACE_TEMPLATES.find((entry) => entry.id === id)?.label ?? id;
  return labeled(`workspaces.template.${id}`, fallback);
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
      setError(created.error.message ?? created.error.code ?? t("workspaces.errors.create"));
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
      setError(t("workspaces.nameRequired"));
      return;
    }
    const modes = withChat(editModes);
    const saved = await apiFetch(`/api/v1/workspaces/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, productModes: modes }),
    }).then((res) => res.json());
    if (saved.error) {
      setError(saved.error.message ?? t("workspaces.errors.update"));
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
      setError(t("workspaces.errors.protected"));
      return;
    }
    if (deleteConfirm.trim() !== workspace.name) {
      setError(t("workspaces.errors.confirmName"));
      return;
    }
    const deleted = await apiFetch(`/api/v1/workspaces/${workspace.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: deleteConfirm.trim() }),
    }).then((res) => res.json());
    if (deleted.error) {
      setError(deleted.error.message ?? t("workspaces.errors.delete"));
      return;
    }
    setDeletingId(null);
    setDeleteConfirm("");
    await reload();
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-[var(--content-narrow)] px-6 py-8 text-[var(--text)]">
      <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("workspaces.title")}</h1>
      <p className="mt-2 text-[var(--text-2)]">{t("workspaces.lede")}</p>
      {creating ? (
        <form
          onSubmit={(event) => void createWorkspace(event)}
          className="mt-8 space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
          data-testid="workspace-create-form"
        >
          <fieldset>
            <legend className="text-sm font-medium text-[var(--text)]">{t("workspaces.templateLegend")}</legend>
            <div className="mt-2 flex flex-wrap gap-2" data-testid="workspace-template-picker">
              <button
                type="button"
                className={`${chipBase} ${templatePack === null ? chipOn : chipOff}`}
                data-testid="workspace-template-blank"
                aria-pressed={templatePack === null}
                data-selected={templatePack === null ? "true" : "false"}
                onClick={() => applyPreset(null)}
              >
                {t("workspaces.blank")}
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
                    title={labeled(`workspaces.templateDescription.${template.id}`, template.description)}
                    onClick={() => applyPreset(template.id)}
                  >
                    {labeled(`workspaces.template.${template.id}`, template.label)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium text-[var(--text)]">{t("workspaces.modes")}</legend>
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
                    {labeled(`workspaces.mode.${mode.id}`, mode.label)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <input
              className="min-w-[12rem] flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
              placeholder={t("workspaces.namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              data-testid="workspace-name"
            />
            <button type="submit" className="btn btn-primary" data-testid="create-workspace">
              {t("workspaces.create")}
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm text-[var(--text-2)] underline"
              data-testid="cancel-create-workspace"
              onClick={closeCreate}
            >
              {t("workspaces.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn-primary mt-8 rounded-pill px-3 py-1.5 text-sm"
          data-testid="create-new-workspace"
          onClick={openCreate}
        >
          {t("workspaces.createNew")}
        </button>
      )}
      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
      <ul className="mt-8 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3" data-testid="workspace-list">
        {workspaces.map((workspace) => {
          const packLabel = templateLabel(workspace.templatePack);
          const modes = workspace.productModes ?? [];
          const dirty = editName.trim() !== workspace.name || !sameModes(withChat(editModes), withChat(modes));
          return (
            <li key={workspace.id} className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--text)]">
                    {workspace.name}
                    {packLabel ? <span className="ml-2 text-xs font-normal text-[var(--text-3)]">{packLabel}</span> : null}
                  </p>
                  <p className="text-xs text-[var(--text-3)]">
                    {workspace.id === currentId ? t("workspaces.currentPrefix") : ""}
                    {modes.map((id) => labeled(`workspaces.mode.${id}`, PRODUCT_MODES.find((mode) => mode.id === id)?.label ?? id)).join(", ")}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm text-[var(--accent)] underline"
                    onClick={() => openEditor(workspace)}
                    data-testid="edit-workspace-modes"
                  >
                    {t("workspaces.edit")}
                  </button>
                  {workspace.protected || workspace.slug === "home" ? null : (
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-sm text-[var(--danger)] underline"
                      onClick={() => openDelete(workspace)}
                      data-testid="delete-workspace"
                    >
                      {t("workspaces.delete")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm text-[var(--accent)] underline"
                    onClick={() => void openWorkspace(workspace.id)}
                    data-testid="open-workspace"
                  >
                    {t("workspaces.open")}
                  </button>
                </div>
              </div>
              {editingId === workspace.id ? (
                <div className="mt-3 space-y-3">
                  <label className="block text-sm font-medium text-[var(--text)]">
                    {t("workspaces.name")}
                    <input
                      className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      data-testid="workspace-edit-name"
                    />
                  </label>
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">{t("workspaces.modes")}</p>
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
                            {labeled(`workspaces.mode.${mode.id}`, mode.label)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary text-sm disabled:opacity-50"
                      data-testid="save-workspace-modes"
                      disabled={!dirty || !editName.trim()}
                      onClick={() => void saveDesk(workspace.id, workspace.name, modes)}
                    >
                      {t("workspaces.save")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-2 text-sm text-[var(--text-2)] underline"
                      data-testid="cancel-workspace-modes"
                      onClick={() => setEditingId(null)}
                    >
                      {t("workspaces.cancel")}
                    </button>
                  </div>
                </div>
              ) : null}
              {deletingId === workspace.id ? (
                <div className="mt-3 space-y-3 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3" data-testid="delete-workspace-confirm">
                  <p className="text-sm text-[var(--text)]">
                    {t("workspaces.deleteConfirm", { name: workspace.name })}
                  </p>
                  <input
                    className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
                    value={deleteConfirm}
                    onChange={(event) => setDeleteConfirm(event.target.value)}
                    placeholder={workspace.name}
                    data-testid="delete-workspace-confirm-name"
                    autoComplete="off"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-pill bg-[var(--danger)] px-3 py-1.5 text-sm text-[var(--surface)] disabled:opacity-50"
                      data-testid="delete-workspace-confirm-submit"
                      disabled={deleteConfirm.trim() !== workspace.name}
                      onClick={() => void deleteDesk(workspace)}
                    >
                      {t("workspaces.deleteDesk")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-3 py-2 text-sm text-[var(--text-2)] underline"
                      data-testid="delete-workspace-cancel"
                      onClick={() => {
                        setDeletingId(null);
                        setDeleteConfirm("");
                      }}
                    >
                      {t("workspaces.cancel")}
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
