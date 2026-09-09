"use client";

import { useState, type KeyboardEvent } from "react";
import { WATCHLIST_MAX } from "@agentforge/core/market";
import { mergeTickers } from "@/lib/market-client";

type Props = {
  tickers: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  testIdPrefix?: string;
};

const COMMIT_KEYS = new Set(["Enter", ",", ";", " "]);

/**
 * Text box that turns typed symbols into chips. Enter, comma, semicolon, space,
 * paste, or blur commits what is typed; each chip has its own remove button.
 */
export function MarketWatchlistInput({ tickers, onChange, disabled = false, testIdPrefix = "market" }: Props) {
  const [draft, setDraft] = useState("");
  const full = tickers.length >= WATCHLIST_MAX;

  function commit(text: string): void {
    if (!text.trim()) {
      return;
    }
    const next = mergeTickers(tickers, text);
    onChange(next);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (COMMIT_KEYS.has(event.key)) {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && tickers.length > 0) {
      onChange(tickers.slice(0, -1));
    }
  }

  return (
    <div>
      <label htmlFor="market-tickers-input" className="panel-label">
        Watchlist
      </label>
      <div
        className="input mt-2 flex min-h-[42px] flex-wrap items-center gap-1.5 py-1.5"
        data-testid={`${testIdPrefix}-watchlist-input`}
      >
        {tickers.map((ticker) => (
          <span
            key={ticker}
            className="inline-flex items-center gap-1 rounded-md border border-mist bg-mist/40 px-2 py-0.5 font-mono text-xs text-ink"
            data-testid={`${testIdPrefix}-ticker-chip`}
            data-ticker={ticker}
          >
            {ticker}
            <button
              type="button"
              className="text-ink/50 hover:text-ink disabled:opacity-50"
              aria-label={`Remove ${ticker}`}
              disabled={disabled}
              onClick={() => onChange(tickers.filter((item) => item !== ticker))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="market-tickers-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          onPaste={(event) => {
            event.preventDefault();
            commit(`${draft} ${event.clipboardData.getData("text")}`);
          }}
          className="min-w-[10rem] flex-1 bg-transparent font-mono uppercase outline-none placeholder:normal-case"
          placeholder={tickers.length === 0 ? "MU, WDC, NVDA, BBCA.JK …" : full ? "Watchlist is full" : "Add…"}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || full}
          data-testid={`${testIdPrefix}-tickers`}
        />
      </div>
      <p className="mt-1 text-[11px] text-[color-mix(in_srgb,var(--color-text)_45%,transparent)]">
        {tickers.length}/{WATCHLIST_MAX} · Yahoo symbols from any market: US tickers as-is, Jakarta with .JK, indexes
        with ^.
      </p>
    </div>
  );
}
