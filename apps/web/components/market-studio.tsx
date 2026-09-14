"use client";

import { useState, type FormEvent } from "react";
import { DEFAULT_WATCH_PROMPT_EN, DEFAULT_WATCH_PROMPT_ID } from "@agentforge/core/market";
import { ArtifactActions } from "@/components/artifact-actions";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { JobProgressList } from "@/components/job-progress";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { MarketBoard } from "@/components/market-board";
import { MarketBriefingView } from "@/components/market-briefing-view";
import { MarketWatchlistInput } from "@/components/market-watchlist-input";
import { ModelSelect } from "@/components/model-select";
import {
  DEFAULT_MAX_CHARS,
  MARKET_STARTERS,
  MAX_MAX_CHARS,
  MIN_MAX_CHARS,
  POSITION_PLACEHOLDER,
  applyRegeneratedSection,
  downloadMarketDocx,
  friendlyMarketError,
  needsKey,
  regenerateBriefingSection,
  type MarketStarter,
  type MarketWatchRequest,
  type MarketWatchResult,
  type WatchLanguage,
} from "@/lib/market-client";
import { useJobModel } from "@/lib/use-job-model";
import { useJobStream } from "@/lib/use-job-stream";
import { useMarketBoard } from "@/lib/use-market-board";
import { t, getLocale } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { useProductBrand } from "@/lib/product-brand";
import { SettingsLinkHint } from "@/components/settings-link-hint";

const DEFAULT_PROMPT: Record<WatchLanguage, string> = { id: DEFAULT_WATCH_PROMPT_ID, en: DEFAULT_WATCH_PROMPT_EN };
const DEFAULT_PROMPTS = new Set<string>([DEFAULT_WATCH_PROMPT_ID, DEFAULT_WATCH_PROMPT_EN]);

function isLanguage(value: string): value is WatchLanguage {
  return value === "id" || value === "en";
}

function clampMaxChars(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_CHARS;
  }
  return Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, Math.round(value)));
}

export function MarketStudio() {
  const { productName } = useProductBrand();
  const { models, model, setModel } = useJobModel("market");
  const job = useJobStream<MarketWatchResult>();
  const [tickers, setTickers] = useState<string[]>([]);
  const [language, setLanguage] = useState<WatchLanguage>(() => getLocale());
  const [prompt, setPrompt] = useState<string>(DEFAULT_WATCH_PROMPT_ID);
  const [position, setPosition] = useState("");
  const [maxChars, setMaxChars] = useState<number>(DEFAULT_MAX_CHARS);
  const [showOptions, setShowOptions] = useState(false);
  const [result, setResult] = useState<MarketWatchResult | null>(null);
  const [busy, setBusy] = useState<"download" | "regen" | null>(null);
  const [regenIndex, setRegenIndex] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // A finished job keeps its error forever; this hides it once the user edits the watchlist.
  const [errorStale, setErrorStale] = useState(false);
  const board = useMarketBoard(tickers);

  const rawError = errorStale ? null : (localError ?? job.error?.message ?? null);
  const error = rawError ? friendlyMarketError(rawError) : null;
  const locked = job.busy || busy !== null;
  const ready = tickers.length > 0 && prompt.trim().length > 0;

  function changeTickers(next: string[]): void {
    setTickers(next);
    setLocalError(null);
    setErrorStale(true);
  }

  function onLanguageChange(next: string): void {
    if (!isLanguage(next)) {
      return;
    }
    setLanguage(next);
    // Swap the prefilled instruction only while the user has not written their own.
    if (DEFAULT_PROMPTS.has(prompt.trim())) {
      setPrompt(DEFAULT_PROMPT[next]);
    }
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    if (locked || tickers.length === 0) {
      return;
    }
    setLocalError(null);
    setErrorStale(false);
    const body: MarketWatchRequest = {
      prompt: (prompt.trim() || DEFAULT_PROMPT[language]).trim(),
      tickers,
      positionContext: position.trim(),
      language,
      maxChars: clampMaxChars(maxChars),
      model: model || undefined,
    };
    const next = await job.run("/api/v1/market/stream", body);
    if (next) {
      setResult(next);
    }
  }

  async function onRegenerate(index: number, payload: JobRegenSubmit) {
    if (!result || locked) {
      return;
    }
    setBusy("regen");
    setRegenIndex(index);
    setLocalError(null);
    try {
      const rewritten = await regenerateBriefingSection({
        briefing: result.briefing,
        section: index,
        instruction: payload.instruction || undefined,
        model: payload.model || model || undefined,
      });
      setResult((current) => (current ? applyRegeneratedSection(current, index, rewritten) : current));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("market.errors.rewrite"));
    } finally {
      setBusy(null);
      setRegenIndex(null);
    }
  }

  async function onDownload() {
    if (!result || locked) {
      return;
    }
    setBusy("download");
    setLocalError(null);
    try {
      await downloadMarketDocx(result.briefing);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t("market.errors.docx"));
    } finally {
      setBusy(null);
    }
  }

  function applyStarter(starter: MarketStarter) {
    changeTickers([...starter.tickers]);
  }

  return (
    <main className="px-6 pb-10 pt-8 text-[var(--text)]" data-testid="market-studio">
      <div className="kicker">{t("market.studio.kicker")}</div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div>
          <h3 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">
            {t("market.studio.title")}
          </h3>
          <p className="mt-1.5 max-w-xl text-sm text-[var(--text-2)]">{t("market.studio.subtitle")}</p>
        </div>
        {result ? (
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={locked}
            className="btn btn-primary ml-auto"
            data-testid="market-download"
          >
            {busy === "download" ? t("market.studio.building") : t("market.studio.download")}
          </button>
        ) : null}
      </div>

      {error && tickers.length === 0 ? (
        <p className="mb-4 text-sm text-[var(--danger)]" role="alert" data-testid="market-error">
          {error}
          {needsKey(rawError ?? "") ? (
            <>
              {" "}
              <SettingsLinkHint i18nKey="market.studio.openSettings" testId="market-error-settings" />
            </>
          ) : null}
        </p>
      ) : null}

      <form className="space-y-4" onSubmit={(event) => void onGenerate(event)} data-testid="market-inputs">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <MarketWatchlistInput tickers={tickers} onChange={changeTickers} disabled={locked} />
          {tickers.length === 0 ? (
            <div className="mt-3" data-testid="market-starters">
              <p className="text-xs text-[var(--text-3)]">{t("market.studio.startersLead")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {MARKET_STARTERS.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    className="rounded-md border border-[var(--line)] px-3 py-1.5 text-left text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]"
                    data-testid="market-starter"
                    title={starter.tickers.join(", ")}
                    onClick={() => applyStarter(starter)}
                    disabled={locked}
                  >
                    <span className="font-medium">{labeled(`market.starters.${starter.id}.label`, starter.label)}</span>
                    <span className="ml-2 text-[var(--text-3)]">
                      {labeled(`market.starters.${starter.id}.hint`, starter.hint)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {tickers.length > 0 ? (
          <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
            {error ? (
              <p className="text-sm text-[var(--danger)]" role="alert" data-testid="market-error">
                {error}
                {needsKey(rawError ?? "") ? (
                  <>
                    {" "}
                    <SettingsLinkHint i18nKey="market.studio.openSettings" testId="market-error-settings" />
                  </>
                ) : null}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={locked || !ready}
                data-testid="market-generate"
              >
                {job.busy ? t("market.studio.writing") : t("market.studio.writeBriefing")}
              </button>
              {job.busy ? (
                <button type="button" className="btn" onClick={job.cancel} data-testid="market-cancel">
                  {t("market.studio.cancel")}
                </button>
              ) : null}
              <select
                aria-label={t("market.studio.languageAria")}
                className="input"
                style={{ width: "auto" }}
                value={language}
                onChange={(event) => onLanguageChange(event.target.value)}
                disabled={locked}
                data-testid="market-language"
              >
                <option value="id">{t("common.bahasa")}</option>
                <option value="en">{t("common.english")}</option>
              </select>
              <button
                type="button"
                className="text-xs text-[var(--text-2)] underline"
                onClick={() => setShowOptions(!showOptions)}
                aria-expanded={showOptions}
                data-testid="market-options-toggle"
              >
                {showOptions ? t("market.studio.hideOptions") : t("market.studio.options")}
              </button>
            </div>
            <p className="text-xs text-[var(--text-3)]">{t("market.studio.machineNote", { product: productName })}</p>

            {showOptions ? (
              <div className="space-y-4 border-t border-[var(--line)] pt-4" data-testid="market-options">
                <div>
                  <label htmlFor="market-position-input" className="panel-label">
                    {t("market.studio.positionLabel")}
                  </label>
                  <textarea
                    id="market-position-input"
                    rows={3}
                    value={position}
                    onChange={(event) => setPosition(event.target.value)}
                    className="input mt-2 text-[13px]"
                    placeholder={POSITION_PLACEHOLDER}
                    disabled={locked}
                    data-testid="market-position"
                  />
                  <p className="mt-1 text-xs text-[var(--text-3)]">{t("market.studio.positionHelp")}</p>
                </div>
                <div>
                  <label htmlFor="market-prompt-input" className="panel-label">
                    {t("market.studio.promptLabel")}
                  </label>
                  <textarea
                    id="market-prompt-input"
                    rows={7}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    className="input mt-2 text-[13px]"
                    disabled={locked}
                    data-testid="market-prompt"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn text-xs"
                      onClick={() => setPrompt(DEFAULT_PROMPT[language])}
                      disabled={locked || prompt === DEFAULT_PROMPT[language]}
                      data-testid="market-prompt-reset"
                    >
                      {t("market.studio.resetPrompt")}
                    </button>
                    <EnhancePromptButton
                      text={prompt}
                      surface="market"
                      model={model}
                      disabled={locked}
                      testId="market-enhance"
                      onApply={setPrompt}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label htmlFor="market-maxchars-input" className="panel-label">
                      {t("market.studio.lengthLimit")}
                    </label>
                    <input
                      id="market-maxchars-input"
                      type="number"
                      min={MIN_MAX_CHARS}
                      max={MAX_MAX_CHARS}
                      step={500}
                      className="input mt-2 w-40"
                      value={maxChars}
                      onChange={(event) => setMaxChars(Number(event.target.value))}
                      onBlur={() => setMaxChars(clampMaxChars(maxChars))}
                      disabled={locked}
                      data-testid="market-maxchars"
                    />
                  </div>
                  <ModelSelect
                    models={models}
                    value={model}
                    onChange={setModel}
                    disabled={locked}
                    testId="market-studio-model"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {tickers.length > 0 ? (
          <MarketBoard
            board={board.board}
            loading={board.loading}
            error={board.error}
            tickers={tickers}
            onRefresh={board.refresh}
          />
        ) : null}
      </form>

      <div className="mt-5 space-y-4">
        {job.busy || (job.progress.phases.length > 0 && !result) ? (
          <JobProgressList progress={job.progress} busy={job.busy} testId="market-progress" />
        ) : null}
        {result ? (
          <>
            <ArtifactActions
              title={result.briefing.title}
              markdown={result.markdown}
              artifactId={result.artifactId}
              kbType="Brief"
              disabled={locked}
              testIdPrefix="market"
            />
            <MarketBriefingView
              briefing={result.briefing}
              guard={result.guard}
              models={models}
              defaultModel={model}
              regeneratingIndex={regenIndex}
              onRegenerate={(index, payload) => void onRegenerate(index, payload)}
            />
          </>
        ) : null}
        {tickers.length === 0 && !job.busy ? (
          <div
            className="wash rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-[var(--text-2)]"
            data-testid="market-studio-empty"
          >
            <p>{t("market.studio.empty")}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
