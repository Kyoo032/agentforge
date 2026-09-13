"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    void apiFetch("/api/v1/workspaces")
      .then((res) => res.json())
      .then((payload) => {
        setWorkspaces(payload.workspaces ?? []);
        setCurrentId(payload.currentWorkspaceId ?? null);
      });
  }, [workspaceName]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function place() {
      const el = triggerRef.current;
      if (!el) {
        return;
      }
      const rect = el.getBoundingClientRect();
      if (compact) {
        setMenuPos({ top: rect.top, left: rect.right + 6, width: 192 });
        return;
      }
      setMenuPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180) });
    }
    place();
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, compact]);

  async function openWorkspace(id: string) {
    await apiFetch(`/api/v1/workspaces/${id}/select`, { method: "POST" });
    setOpen(false);
    router.push("/chat");
    router.refresh();
  }

  const triggerClass = compact
    ? "flex justify-center rounded-[8px] px-2 py-1 text-[12px] font-medium text-[var(--text-3)] hover:bg-[var(--accent-soft)]"
    : "flex w-full items-center gap-1 truncate rounded-[8px] px-0 py-0 text-left text-[12px] text-[var(--text-3)] hover:text-[var(--text)]";

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="elev-md fixed z-[80] rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-1"
            role="listbox"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="option"
                aria-selected={workspace.id === currentId}
                className="block w-full truncate rounded-[8px] px-2 py-1.5 text-left text-[14px] text-[var(--text)] hover:bg-[var(--accent-soft)]"
                onClick={() => void openWorkspace(workspace.id)}
                data-testid="open-workspace"
              >
                {workspace.name}
                {workspace.id === currentId ? " · current" : ""}
              </button>
            ))}
            <Link
              href="/workspaces"
              className="mt-1 block rounded-[8px] px-2 py-1.5 text-[14px] text-[var(--accent)] hover:bg-[var(--accent-soft)]"
              data-testid="workspace-new-link"
              onClick={() => setOpen(false)}
            >
              New workspace…
            </Link>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="relative" data-testid="workspaces-switcher">
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={workspaceName}
        aria-label={`Workspace: ${workspaceName}`}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          const el = triggerRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            if (compact) {
              setMenuPos({ top: rect.top, left: rect.right + 6, width: 192 });
            } else {
              setMenuPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180) });
            }
          }
          setOpen(true);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{compact ? workspaceName.slice(0, 1) : workspaceName}</span>
        {compact ? null : (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 opacity-50">
            <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {menu}
    </div>
  );
}
