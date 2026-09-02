"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@agentforge/core/gateway";

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

const pillClass =
  "inline-flex h-8 items-center rounded-md border border-mist bg-paper px-2.5 text-xs tabular-nums text-ink/60";

export function ChatUsageChip() {
  const [label, setLabel] = useState<string | null>("…");
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/settings");
        if (!res.ok) {
          if (!cancelled) setHidden(true);
          return;
        }
        const payload = (await res.json()) as { usage?: SettingsUsage; error?: { message?: string } };
        if (cancelled) return;
        if (payload.error || !payload.usage?.thisKey) {
          setHidden(true);
          return;
        }
        const thisKey = payload.usage.thisKey;
        if (thisKey.status === "needs_key") {
          setLabel("No key saved");
          setTitle(undefined);
          return;
        }
        if (thisKey.status === "error") {
          setLabel("Usage unavailable");
          setTitle(thisKey.message);
          return;
        }
        if (thisKey.data.unlimited) {
          setLabel("Unlimited");
          setTitle(undefined);
          return;
        }
        const used = formatUsd(thisKey.data.usedUsd ?? 0);
        const left =
          thisKey.data.remainingUsd == null ? "—" : formatUsd(thisKey.data.remainingUsd);
        setLabel(`${used} used · ${left} left`);
        setTitle(undefined);
      } catch {
        if (!cancelled) setHidden(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden || label == null) {
    return null;
  }

  return (
    <span className={pillClass} data-testid="chat-usage" title={title}>
      {label}
    </span>
  );
}
