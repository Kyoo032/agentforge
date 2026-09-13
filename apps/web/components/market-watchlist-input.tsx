"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { lookupWatchTicker, suggestWatchlistTickers, WATCHLIST_MAX } from "@agentforge/core/market";
import { mergeTickersReporting } from "@/lib/market-client";

type Props = {
  tickers: ReadonlyArray<string>;
  onChange: (next: string[]) => void;
  disabled?: boolean;
  testIdPrefix?: string;
};

const LIST_COMMIT_KEYS = new Set([",", ";"]);

function rejectionMessage(rejected: readonly string[]): string {
  const shown = rejected.slice(0, 3).join(", ");
  return `${shown} ${rejected.length === 1 ? "is not" : "are not"} a ticker symbol. Try MU, NVDA, or BBCA.`;
}

/**
 * Text box that turns typed symbols into chips. Enter, comma, semicolon, paste,
 * or blur commits what is typed; each chip has its own remove button.
 * LQ45 names/aliases and the studio's familiar US names suggest as you type.
 */
export function MarketWatchlistInput({ tickers, onChange, disabled = false, testIdPrefix = "market" }: Props) {
  const listId = useId();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const full = tickers.length >= WATCHLIST_MAX;
  const suggestions = useMemo(
    () => (disabled || full ? [] : suggestWatchlistTickers(draft, { exclude: tickers })),
    [disabled, draft, full, tickers],
  );
  const active = suggestions[Math.min(activeIndex, Math.max(suggestions.length - 1, 0))];

  function commit(text: string): void {
    if (!text.trim()) {
      return;
    }
    const { tickers: next, rejected, overflow } = mergeTickersReporting(tickers, text);
    setNotice(
      rejected.length > 0
        ? rejectionMessage(rejected)
        : overflow
          ? `The watchlist holds ${WATCHLIST_MAX} tickers, so the extra ones were not added.`
          : null,
    );
    if (next.length !== tickers.length || next.some((item, index) => item !== tickers[index])) {
      onChange(next);
    }
    setDraft(rejected.length > 0 && next.length === tickers.length ? text.trim() : "");
    setActiveIndex(0);
  }

  function pick(ticker: string): void {
    commit(ticker);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length > 0 && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
      return;
    }
    if (suggestions.length > 0 && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Escape" && suggestions.length > 0) {
      event.preventDefault();
      setDraft("");
      setActiveIndex(0);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (active) {
        pick(active.ticker);
        return;
      }
      commit(lookupWatchTicker(draft) ?? draft);
      return;
    }
    if (event.key === " " && suggestions.length > 0) {
      return;
    }
    if (LIST_COMMIT_KEYS.has(event.key) || (event.key === " " && suggestions.length === 0)) {
      event.preventDefault();
      commit(lookupWatchTicker(draft) ?? draft);
      return;
    }
    if (event.key === "Backspace" && draft === "" && tickers.length > 0) {
      setNotice(null);
      onChange(tickers.slice(0, -1));
    }
  }

  function onBlur(): void {
    const hit = lookupWatchTicker(draft);
    if (hit) {
      commit(hit);
      return;
    }
    if (suggestions.length === 0) {
      commit(draft);
    }
  }

  return (
    <div>
      <label htmlFor="market-tickers-input" className="panel-label">
        Which stocks do you follow?
      </label>
      <div className="relative">
        <div
          className="input mt-2 flex min-h-[46px] flex-wrap items-center gap-1.5 py-1.5"
          data-testid={`${testIdPrefix}-watchlist-input`}
        >
          {tickers.map((ticker) => (
            <span
              key={ticker}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--accent-soft)] py-0.5 pl-2 pr-0.5 font-mono text-xs text-[var(--text)]"
              data-testid={`${testIdPrefix}-ticker-chip`}
              data-ticker={ticker}
            >
              {ticker}
              <button
                type="button"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-3)] hover:bg-[var(--accent-soft)] hover:text-[var(--text)] disabled:opacity-50"
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
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            onPaste={(event) => {
              event.preventDefault();
              commit(`${draft} ${event.clipboardData.getData("text")}`);
            }}
            className="min-w-[8rem] flex-1 bg-transparent font-mono uppercase outline-none placeholder:normal-case"
            placeholder={tickers.length === 0 ? "MU, NVDA, BBCA…" : full ? "That is the maximum" : "Add another…"}
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active ? `${listId}-${active.ticker}` : undefined}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled || full}
            data-testid={`${testIdPrefix}-tickers`}
          />
        </div>
        {suggestions.length > 0 ? (
          <ul
            id={listId}
            role="listbox"
            className="raise absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] py-1"
            data-testid={`${testIdPrefix}-ticker-suggest`}
          >
            {suggestions.map((item, index) => {
              const selected = item.ticker === active?.ticker;
              return (
                <li key={item.ticker} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-${item.ticker}`}
                    role="option"
                    aria-selected={selected}
                    className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm ${
                      selected ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--accent-soft)]"
                    }`}
                    data-testid={`${testIdPrefix}-ticker-option`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(item.ticker)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="font-mono text-[var(--text)]">{item.ticker}</span>
                    <span className="truncate text-xs text-[var(--text-2)]">{item.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {notice ? (
        <p className="mt-1 text-xs text-[var(--danger)]" role="alert" data-testid={`${testIdPrefix}-ticker-notice`}>
          {notice}
        </p>
      ) : (
        <p className="mt-1 text-xs text-[var(--text-3)]">
          Type a ticker or a name. IDX names (BCA, Astra) and the usual US examples (NVIDIA, Micron) fill in.{" "}
          {tickers.length}/{WATCHLIST_MAX}.
        </p>
      )}
    </div>
  );
}
