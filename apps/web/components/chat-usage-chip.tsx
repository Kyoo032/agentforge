"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@agentforge/core/gateway";
import { Link } from "@/lib/nav";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";

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
  const [label, setLabel] = useState(() => t("chat.usage.placeholder"));
  const [title, setTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/v1/settings");
        if (!res.ok) {
          if (!cancelled) setLabel(t("chat.usage.error"));
          return;
        }
        const payload = (await res.json()) as { usage?: SettingsUsage; error?: { message?: string } };
        if (cancelled) return;
        if (payload.error) {
          setLabel(t("chat.usage.error"));
          setTitle(payload.error.message);
          return;
        }
        if (!payload.usage?.thisKey) {
          setLabel(t("chat.usage.placeholder"));
          return;
        }
        const thisKey = payload.usage.thisKey;
        if (thisKey.status === "needs_key") {
          setLabel(t("chat.usage.placeholder"));
          setTitle(undefined);
          return;
        }
        if (thisKey.status === "error") {
          // An error is not "no key yet": say so in the chip and keep the detail in the tooltip.
          setLabel(t("chat.usage.error"));
          setTitle(thisKey.message);
          return;
        }
        if (thisKey.data.unlimited) {
          setLabel(t("chat.usage.unlimited"));
          setTitle(undefined);
          return;
        }
        const left = thisKey.data.remainingUsd == null ? "—" : formatUsd(thisKey.data.remainingUsd);
        setLabel(t("chat.usage.remaining", { left }));
        setTitle(undefined);
      } catch {
        if (!cancelled) setLabel(t("chat.usage.error"));
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
