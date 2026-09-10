"use client";

import { useState, type KeyboardEvent } from "react";
import { WATCHLIST_MAX } from "@agentforge/core/market";
import { mergeTickersReporting } from "@/lib/market-client";

type Props = {
  tickers: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  testIdPrefix?: string;
};

const COMMIT_KEYS = new Set(["Enter", ",", ";", " "]);
const FAINT = "text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]";

function rejectionMessage(rejected: readonly string[]): string {
  const shown = rejected.slice(0, 3).join(", ");
  return `${shown} ${rejected.length === 1 ? "is not" : "are not"} a ticker symbol. Try MU, NVDA, or BBCA.`;
}

/**
 * Text box that turns typed symbols into chips. Enter, comma, semicolon, space,
 * paste, or blur commits what is typed; each chip has its own remove button.
 * Anything that is not a symbol is refused with a message rather than becoming
 * a chip that would fail later at the API.
 */
export function MarketWatchlistInput({ tickers, onChange, disabled = false, testIdPrefix = "market" }: Props) {
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const full = tickers.length >= WATCHLIST_MAX;

  function commit(text: string): void {
    if (!text.trim()) {
      return;
    }
    const { tickers: next, rejected } = mergeTickersReporting(tickers, text);
    setNotice(rejected.length > 0 ? rejectionMessage(rejected) : null);
    if (next.length !== tickers.length || next.some((item, index) => item !== tickers[index])) {
      onChange(next);
    }
    setDraft(rejected.length > 0 && next.length === tickers.length ? text.trim() : "");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (COMMIT_KEYS.has(event.key)) {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && tickers.length > 0) {
      setNotice(null);
      onChange(tickers.slice(0, -1));
    }
  }

  return (
    <div>
      <label htmlFor="market-tickers-input" className="panel-label">
        Which stocks do you follow?
      </label>
      <div
        className="input mt-2 flex min-h-[46px] flex-wrap items-center gap-1.5 py-1.5"
        data-testid={`${testIdPrefix}-watchlist-input`}
      >
        {tickers.map((ticker) => (
          <span
            key={ticker}
            className="inline-flex items-center gap-1 rounded-md border border-mist bg-mist/40 py-0.5 pl-2 pr-0.5 font-mono text-xs text-ink"
            data-testid={`${testIdPrefix}-ticker-chip`}
            data-ticker={ticker}
          >
            {ticker}
            <button
              type="button"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-ink/50 hover:bg-mist hover:text-ink disabled:opacity-50"
              aria-label={`Remove ${ticker}`}
              disabled={disabled}
              onClick={() => {
                setNotice(null);
                onChange(tickers.filter((item) => item !== ticker));
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="market-tickers-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setNotice(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          onPaste={(event) => {
            event.preventDefault();
            commit(`${draft} ${event.clipboardData.getData("text")}`);
          }}
          className="min-w-[8rem] flex-1 bg-transparent font-mono uppercase outline-none placeholder:normal-case"
          placeholder={tickers.length === 0 ? "MU, NVDA, BBCA…" : full ? "That is the maximum" : "Add another…"}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || full}
          data-testid={`${testIdPrefix}-tickers`}
        />
      </div>
      {notice ? (
        <p className="mt-1 text-[11px] text-red-700" role="alert" data-testid={`${testIdPrefix}-ticker-notice`}>
          {notice}
        </p>
      ) : (
        <p className={`mt-1 text-[11px] ${FAINT}`}>
          Type a ticker and press Enter. US stocks as-is (MU, NVDA), Indonesian stocks by code (BBCA), indexes with ^
          (^VIX). {tickers.length}/{WATCHLIST_MAX}.
        </p>
      )}
    </div>
  );
}
