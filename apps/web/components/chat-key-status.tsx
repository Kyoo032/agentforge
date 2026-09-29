"use client";

import { useEffect, useState } from "react";
import { Link } from "@/lib/nav";
import { checkGateway } from "@/lib/api-client";
import { readSettings } from "@/lib/settings-read";
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
  /*
   * False until the first read of the host's gate has answered, whichever way it went. Before that
   * `gate` is null, which is "unknown", not "no key": painting the needs-key copy and a Settings
   * button for those first frames told a desk with a connected key to connect one, then took it
   * back (seen on a fresh load at 375 px, 2026-09-29).
   */
  const [settled, setSettled] = useState(false);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Shared with the shell's gate read and the other Chat readers: one round trip per load.
        const answer = await readSettings();
        if (!answer.ok) return;
        if (!cancelled) setGate(parseGatewayGate(answer.body?.gateway));
      } catch {
        // status line stays on the needs-key copy
      } finally {
        if (!cancelled) setSettled(true);
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
  if (!settled) {
    // Keeps the pill's height so the hero does not jump when the answer lands; it is not painted.
    line = " ";
    settings = false;
  } else if (gate?.status === "ok") {
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
    <div
      className="mt-[var(--hero-gap,1.5rem)] flex w-full min-w-0 flex-col items-center gap-[var(--hero-gap-tight,0.75rem)]"
      data-testid="chat-key-status"
    >
      <p
        className={`chat-status-pill inline-flex max-w-full items-center whitespace-nowrap rounded-pill border border-[var(--line)] bg-[var(--surface)] text-[var(--text-2)]${settled ? "" : " invisible"}`}
        data-tone={tone}
        aria-hidden={settled ? undefined : true}
        title={line}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
        <span className="min-w-0 truncate">{line}</span>
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
