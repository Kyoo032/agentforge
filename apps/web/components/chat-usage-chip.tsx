"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@agentforge/core/gateway";
import { Link } from "@/lib/nav";
import { apiFetch } from "@/lib/api-client";

type ThisKeyUsage =
  | { status: "needs_key" }
  | {
      status: "ok";
      data: {
        name?: string;
        usedUsd?: number;
        remainingUsd?: number | null;
        unlimited?: boolean;
        expiresAt?: string;
      };
    }
  | { status: "error"; message: string };

type SettingsUsage = {
  thisKey?: ThisKeyUsage;
};

export function ChatUsageChip() {
  const [label, setLabel] = useState("Usage · —");
  const [title, setTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/v1/settings");
        if (!res.ok) {
          return;
        }
        const payload = (await res.json()) as { usage?: SettingsUsage; error?: { message?: string } };
        if (cancelled) return;
        if (payload.error || !payload.usage?.thisKey) {
          setLabel("Usage · —");
          return;
        }
        const thisKey = payload.usage.thisKey;
        if (thisKey.status === "needs_key") {
          setLabel("Usage · —");
          setTitle(undefined);
          return;
        }
        if (thisKey.status === "error") {
          setLabel("Usage · —");
          setTitle(thisKey.message);
          return;
        }
        if (thisKey.data.unlimited) {
          setLabel("Usage · Unlimited");
          setTitle(undefined);
          return;
        }
        const left = thisKey.data.remainingUsd == null ? "—" : formatUsd(thisKey.data.remainingUsd);
        setLabel(`Usage · ${left}`);
        setTitle(undefined);
      } catch {
        if (!cancelled) setLabel("Usage · —");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      href="/usage"
      className="text-xs text-[var(--text-3)] wash hover:text-[var(--text)]"
      data-testid="chat-usage"
      title={title}
    >
      {label}
    </Link>
  );
}
