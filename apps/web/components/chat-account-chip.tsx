"use client";

import { useState } from "react";
import { requestSignOut, signOutAndLeave } from "@/components/account-session-row";
import { useSession } from "@/lib/session";
import { t } from "@/lib/i18n";

/** Labeled account control for the Chat header. Webdev has no session, so the chip stays off. */
export function ChatAccountChip() {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (session.status !== "signed-in") {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="chip wash whitespace-nowrap font-medium"
        data-testid="chat-account"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((was) => !was)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 19.5c1.4-3 3.8-4.5 7-4.5s5.6 1.5 7 4.5" />
        </svg>
        {t("chat.account.label")}
      </button>
      {open ? (
        <div
          className="absolute right-0 z-20 mt-1 min-w-40 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-elev-2"
          role="dialog"
          aria-label={t("chat.account.label")}
        >
          <button
            type="button"
            className="btn w-full"
            disabled={busy}
            data-testid="chat-account-signout"
            onClick={() => {
              setBusy(true);
              void signOutAndLeave(requestSignOut, (url) => window.location.replace(url));
            }}
          >
            {busy ? t("auth.account.signingOut") : t("auth.account.signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
