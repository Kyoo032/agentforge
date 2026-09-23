"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@agentforge/core/gateway";
import { findTier } from "@agentforge/core/plans";
import { Link } from "@/lib/nav";
import { apiFetch } from "@/lib/api-client";
import { useHostCapabilities } from "@/lib/host-capabilities";
import { t } from "@/lib/i18n";
import { parseGatewayGate } from "@/lib/gateway-gate";
import { fetchAccountPlan, type AccountPlan } from "@/lib/plans-api";

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

function planLabel(plan: AccountPlan): string | null {
  const tier = plan.tierId ? findTier(plan.tierId) : null;
  const name = tier ? t(tier.nameKey) : null;
  if (!name) return null;
  if (plan.seatCap !== null) {
    return t("chat.usage.planSeats", { plan: name, used: plan.seatsInUse, cap: plan.seatCap });
  }
  return t("chat.usage.planName", { plan: name });
}

export function ChatUsageChip() {
  const { plans } = useHostCapabilities();
  const [label, setLabel] = useState(() => t("chat.usage.placeholder"));
  const [title, setTitle] = useState<string | undefined>(undefined);
  const [href, setHref] = useState("/usage");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (plans) {
          const plan = await fetchAccountPlan();
          if (!cancelled && plan?.enforced) {
            const next = planLabel(plan);
            if (next) {
              setLabel(next);
              setTitle(undefined);
              setHref("/usage");
              return;
            }
          }
        }
        const res = await apiFetch("/api/v1/settings");
        if (!res.ok) {
          if (!cancelled) setLabel(t("chat.usage.error"));
          return;
        }
        const payload = (await res.json()) as {
          usage?: SettingsUsage;
          gateway?: unknown;
          error?: { message?: string };
        };
        if (cancelled) return;
        if (payload.error) {
          setLabel(t("chat.usage.error"));
          setTitle(payload.error.message);
          setHref("/usage");
          return;
        }
        if (!payload.usage?.thisKey) {
          setLabel(t("chat.usage.placeholder"));
          setHref("/usage");
          return;
        }
        const thisKey = payload.usage.thisKey;
        const gate = parseGatewayGate(payload.gateway);
        if (thisKey.status === "needs_key" && gate?.status === "stub") {
          setLabel(t("chat.usage.placeholder"));
          setTitle(undefined);
          setHref("/usage");
          return;
        }
        if (thisKey.status === "needs_key") {
          setLabel(t("chat.usage.connectKey"));
          setTitle(undefined);
          setHref("/settings");
          return;
        }
        if (thisKey.status === "error") {
          setLabel(t("chat.usage.error"));
          setTitle(thisKey.message);
          setHref("/usage");
          return;
        }
        setHref("/usage");
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
  }, [plans]);

  return (
    <Link
      href={href}
      className="wash inline-flex h-8 items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 text-xs text-[var(--text)] hover:bg-[var(--surface-2)]"
      data-testid="chat-usage"
      title={title}
    >
      {label}
    </Link>
  );
}
