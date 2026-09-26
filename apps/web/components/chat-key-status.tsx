"use client";

import { useEffect, useState } from "react";
import { Link } from "@/lib/nav";
import { apiFetch, checkGateway } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { parseGatewayGate, type GatewayGatePayload } from "@/lib/gateway-gate";
import { useProductBrand } from "@/lib/product-brand";
import { useSession } from "@/lib/session";
import { hostWithholdsLiveModel } from "@/lib/use-desk-needs-key";

function formatChecked(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

/** The dot's colour is the whole status at a glance; the sentence is the detail. */
type Tone = "ok" | "warn" | "neutral";

const DOT: Record<Tone, string> = {
  ok: "bg-[var(--teal)]",
  warn: "bg-[var(--danger)]",
  neutral: "bg-[var(--text-3)]",
};

export function ChatKeyStatus() {
  const session = useSession();
  const { gatewayName } = useProductBrand();
  const [gate, setGate] = useState<GatewayGatePayload | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/v1/settings");
        if (!res.ok) return;
        const payload = (await res.json()) as { gateway?: unknown };
        if (!cancelled) setGate(parseGatewayGate(payload.gateway));
      } catch {
        // status line stays on the needs-key copy
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * `stub` is "no key yet", not a working demo: it is the runtime the host
   * falls back to when nothing has been pasted. It used to render as "Model key
   * connected (offline demo)", which claimed a connection that does not exist
   * and invented a demo that is not a product state (owner report 2026-09-23).
   * It now reads as what it is — a key is needed — and keeps the Settings door.
   */
  let line = t("chat.empty.statusNeedsKey");
  let tone: Tone = "neutral";
  let settings = true;
  let recheck = false;
  if (gate?.status === "ok") {
    line = t("chat.empty.statusConnected");
    tone = "ok";
    settings = false;
  } else if (gate?.allowed && gate.grace) {
    const date = formatChecked(gate.lastOkAt);
    line = date ? t("chat.empty.statusGrace", { date }) : t("chat.empty.statusConnected");
    tone = "ok";
    settings = false;
  } else if (session.status === "signed-in") {
    line = `${t("chat.empty.statusSignedIn")} · ${t("chat.empty.statusReady")}`;
    tone = "ok";
    settings = false;
  } else if (gate?.status === "invalid_key") {
    line = t("onboarding.gate.invalidKey", { gatewayName });
    tone = "warn";
  } else if (gate?.status === "unreachable") {
    line = t("onboarding.gate.unreachable", { gatewayName });
    tone = "warn";
    recheck = true;
  } else if (gate?.status === "error") {
    line = t("onboarding.gate.error");
    tone = "warn";
    recheck = true;
  }

  async function recheckGate() {
    setChecking(true);
    try {
      const next = await checkGateway();
      if (next) setGate(next);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col items-center gap-3" data-testid="chat-key-status">
      <p
        className="inline-flex items-center gap-2 rounded-pill border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text-2)]"
        data-tone={tone}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
        {line}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {settings ? (
          <Link
            href="/settings"
            className={hostWithholdsLiveModel(gate) ? "btn btn-primary" : "btn"}
            data-testid="chat-empty-settings"
          >
            {t("chat.empty.settingsLink")}
          </Link>
        ) : null}
        {recheck ? (
          <button type="button" className="btn" disabled={checking} onClick={() => void recheckGate()}>
            {checking ? t("common.loading") : t("chat.empty.recheck")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="chat-whats-this"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {t("chat.empty.whatsThis")}
        </button>
      </div>
      {open ? (
        <p className="max-w-md text-left text-sm text-[var(--text-2)]" data-testid="chat-whats-this-body">
          {t("chat.empty.whatsThisBody")}
        </p>
      ) : null}
    </div>
  );
}
