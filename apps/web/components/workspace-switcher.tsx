"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@/lib/nav";
import { useRouter } from "@/lib/nav";
import { apiFetch } from "@/lib/api-client";
import { notifyThreadsChanged } from "@/lib/threads-events";
import { BrandMark } from "@/components/brand-mark";

type Workspace = { id: string; name: string; slug: string };

type Props = {
  workspaceName: string;
  compact?: boolean;
  logoSrc?: string;
  /** The product name, so the mark is announced rather than skipped. Never a hard-coded brand. */
  logoAlt?: string;
};

export function WorkspaceSwitcher({ workspaceName, compact = false, logoSrc = "", logoAlt = "" }: Props) {
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
    // Sessions are per desk: tell every session list to reload before the route settles.
    notifyThreadsChanged();
    setOpen(false);
    router.push("/chat");
    router.refresh();
  }

  const triggerClass = compact
    ? "wash flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium text-[var(--text)] hover:bg-[var(--accent-soft)]"
    : "wash flex w-full items-center gap-1 truncate rounded-lg py-0 text-left text-xs text-[var(--text-3)] hover:text-[var(--text)]";

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="raise fixed z-[80] rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1"
            role="listbox"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
          >
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="option"
                aria-selected={workspace.id === currentId}
                className="wash block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--accent-soft)]"
                onClick={() => void openWorkspace(workspace.id)}
                data-testid="open-workspace"
              >
                {workspace.name}
                {workspace.id === currentId ? " · current" : ""}
              </button>
            ))}
            <Link
              href="/workspaces"
              className="wash mt-1 block rounded-lg px-2 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent-soft)]"
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
        {compact ? (
          logoSrc ? (
            <img src={logoSrc} alt={logoAlt} className="h-5 w-5 object-contain" data-testid="product-logo" />
          ) : (
            <BrandMark size={20} className="text-[var(--accent)]" testId="product-logo" />
          )
        ) : (
          <span className="min-w-0 flex-1 truncate">{workspaceName}</span>
        )}
        {compact ? null : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-[var(--accent)]"
          >
            <path
              d="M3 4.5 6 8l3-3.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      {menu}
    </div>
  );
}
