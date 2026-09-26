"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { usePathname, useSearchParams } from "@/lib/nav";
import { ArtifactActions } from "@/components/artifact-actions";
import { EnhancePromptButton } from "@/components/enhance-prompt-button";
import { JobProgressList } from "@/components/job-progress";
import type { JobRegenSubmit } from "@/components/job-regen-panel";
import { MarketBoard } from "@/components/market-board";
import { MarketBriefingView } from "@/components/market-briefing-view";
import { MarketWatchlistInput } from "@/components/market-watchlist-input";
import { ModeHeader } from "@/components/mode-header";
import { ModeIcon } from "@/components/mode-icons";
import { ModelSelect } from "@/components/model-select";
import {
  DEFAULT_MAX_CHARS,
  DEFAULT_MARKET_DEPTH,
  DEFAULT_MARKET_SPECIALIST,
  MARKET_DEPTHS,
  MARKET_STARTERS,
  MAX_MAX_CHARS,
  MIN_MAX_CHARS,
  POSITION_PLACEHOLDER,
  applyRegeneratedSection,
  defaultWatchPrompt,
  downloadMarketDocx,
  friendlyMarketError,
  isMarketSpecialist,
  localizeMarketProgress,
  needsKey,
  nextDepth,
  nextPrompt,
  regenerateBriefingSection,
  specialistHint,
  specialistLabel,
  specialistStarterTickers,
  teamAvailable,
  type MarketDepth,
  type MarketSpecialist,
  type MarketStarter,
  type MarketWatchRequest,
  type MarketWatchResult,
  type WatchLanguage,
} from "@/lib/market-client";
import { specialistSourcesLine } from "@/lib/market-specialist";
import { loadWatchlist, saveWatchlist } from "@/lib/market-watchlists";
import { useWorkspaceScope } from "@/lib/workspace-scope";
import { useJobModel } from "@/lib/use-job-model";
import { modelPickBody, regenModelPick, studioModelPick } from "@/lib/model-choice";
import { useJobStream } from "@/lib/use-job-stream";
import { useMarketBoard } from "@/lib/use-market-board";
import { t, getLocale } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { useProductBrand } from "@/lib/product-brand";
import { SettingsLinkHint } from "@/components/settings-link-hint";

function isLanguage(value: string): value is WatchLanguage {
  return value === "id" || value === "en";
}

/** The rail links a desk as `/market?specialist=<id>`; this pane reads it back. */
const MARKET_PATH = "/market";

function clampMaxChars(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_CHARS;
  }
  return Math.min(MAX_MAX_CHARS, Math.max(MIN_MAX_CHARS, Math.round(value)));
}

export function MarketStudio() {
  const { productName } = useProductBrand();
  const { models, model, pinned: modelPinned, setModel } = useJobModel("market");
  const job = useJobStream<MarketWatchResult>();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { id: workspaceId } = useWorkspaceScope();

  /*
   * The agent is chosen in the rail, so the URL owns it. This pane is kept
   * mounted behind the other work modes, and off `/market` the query string
   * belongs to whatever page is showing — so the last desk seen on `/market`
   * is what stays active rather than the default silently taking over.
   */
  const onMarket = pathname === MARKET_PATH;
  const rawSpecialist = searchParams.get("specialist");
  const urlSpecialist: MarketSpecialist = isMarketSpecialist(rawSpecialist) ? rawSpecialist : DEFAULT_MARKET_SPECIALIST;
  const lastSpecialistRef = useRef<MarketSpecialist>(urlSpecialist);
  const specialist = onMarket ? urlSpecialist : lastSpecialistRef.current;

  const [tickers, setTickers] = useState<string[]>(() => loadWatchlist(workspaceId, specialist));
  const [language, setLanguage] = useState<WatchLanguage>(() => getLocale());
  const [depth, setDepth] = useState<MarketDepth>(DEFAULT_MARKET_DEPTH);
  const [prompt, setPrompt] = useState<string>(() => defaultWatchPrompt(specialist, getLocale()));
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
  const scopeKey = `${workspaceId ?? ""}|${specialist}`;
  const lastScopeRef = useRef(scopeKey);

  const rawError = errorStale ? null : (localError ?? job.error?.message ?? null);
  const error = rawError ? friendlyMarketError(rawError) : null;
  const locked = job.busy || busy !== null;
  const ready = tickers.length > 0 && prompt.trim().length > 0;

  /*
   * Only a desk whose harness names analysts can run the team. The state is
   * still clamped on the way out rather than trusted: a desk switch and a
   * render can race, and the host would have to refuse a depth this desk never
   * offered. `teamReady` drives the control, `requestDepth` is what is sent.
   */
  const teamReady = teamAvailable(specialist);
  const requestDepth = nextDepth({ depth, specialist });

  /*
   * `JobProgressList` shows the label the host streamed, and the packet phases
   * are labelled there in English. The team phases are the first market phases
   * the catalog carries, so they are swapped to the reader's language here; a
   * phase the catalog does not know keeps whatever the host called it.
   */
  const teamProgress = localizeMarketProgress(job.progress, labeled);

  /*
   * Every desk keeps its own board. When the rail points the URL at another
   * agent this pane swaps to that agent's watchlist — its starter list the
   * first time it is opened — and, while the instruction box still holds one
   * of our defaults, to that agent's default instruction. The board refetches
   * off `tickers`, so nothing else has to be told about the move.
   */
  useEffect(() => {
    const movedDesk = lastSpecialistRef.current !== specialist;
    lastSpecialistRef.current = specialist;
    if (!movedDesk && lastScopeRef.current === scopeKey) {
      return;
    }
    lastScopeRef.current = scopeKey;
    setTickers(loadWatchlist(workspaceId, specialist));
    setLocalError(null);
    setErrorStale(true);
    if (movedDesk) {
      setPrompt((current) => nextPrompt({ prompt: current, specialist, language }));
      // A desk with no analysts cannot be read in team depth; drop back to quick.
      setDepth((current) => nextDepth({ depth: current, specialist }));
    }
  }, [scopeKey, specialist, workspaceId, language]);

  function changeTickers(next: string[]): void {
    setTickers(next);
    // Chips are the board; remember them for this desk and this agent alone.
    saveWatchlist(workspaceId, specialist, next);
    setLocalError(null);
    setErrorStale(true);
  }

  function onLanguageChange(next: string): void {
    if (!isLanguage(next)) {
      return;
    }
    setLanguage(next);
    // Swap the prefilled instruction only while the user has not written their own.
    setPrompt(nextPrompt({ prompt, specialist, language: next }));
  }

  async function onGenerate(event: FormEvent) {
    event.preventDefault();
    if (locked || tickers.length === 0) {
      return;
    }
    setLocalError(null);
    setErrorStale(false);
    const body: MarketWatchRequest = {
      prompt: (prompt.trim() || defaultWatchPrompt(specialist, language)).trim(),
      tickers,
      positionContext: position.trim(),
      language,
      specialist,
      depth: requestDepth,
      maxChars: clampMaxChars(maxChars),
      // Only a deliberate pick travels as pinned: a seeded default stays rescuable by the host's fallback.
      ...modelPickBody(studioModelPick(model, modelPinned)),
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
        ...modelPickBody(regenModelPick(payload.model, model, modelPinned)),
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

  // The catalog names the agents; the core meta is the fallback when a key is missing.
  const uiLocale = getLocale();
  const specialistName = (id: MarketSpecialist): string =>
    labeled(`market.specialists.${id}.label`, specialistLabel(id, uiLocale));
  const specialistTip = (id: MarketSpecialist): string =>
    labeled(`market.specialists.${id}.hint`, specialistHint(id, uiLocale));

  /*
   * Where this agent's numbers come from, read off its harness. The vendor
   * names stay in English; only the on-device wording is translated.
   *
   * A desk whose harness allows web research would earn a "· Web" item, but
   * nothing the studio already loads says whether a web key is configured —
   * `/api/v1/settings` carries no readiness flag and `useJobModel` keeps the
   * payload to itself — so the badge stays silent about it rather than
   * promising a source that may not be wired.
   */
  const specialistSources = specialistSourcesLine({
    specialist,
    prefix: t("market.studio.sourcesLabel"),
    computedLabel: t("market.studio.sourcesComputed"),
  });

  /*
   * The agent is picked in the left rail, under the Market entry, and the row
   * that was clicked is in the URL — so the studio only has to say which desk
   * is open. One header line, mounted once: beside the language select while a
   * watchlist exists, and in the empty state above the starters.
   */
  const specialistPicker = (
    <div className="flex flex-col gap-1" role="group" aria-label={t("market.studio.specialistAria")}>
      <span className="panel-label">{t("market.studio.specialistLabel")}</span>
      <span
        className="text-sm font-medium text-[var(--text)]"
        title={specialistTip(specialist)}
        data-testid="market-specialist-current"
      >
        {specialistName(specialist)}
      </span>
      <span className="text-xs text-[var(--text-3)]" data-testid="market-specialist-hint">
        {specialistTip(specialist)}
      </span>
      <span className="text-xs text-[var(--text-3)]" data-testid="market-specialist-sources">
        {specialistSources}
      </span>
    </div>
  );

  /*
   * Quick is one call over the packet; Team is four analyst reads, a bull and
   * bear round, and a risk pass before the briefing is written. Written once
   * and mounted beside both placements of the header above, so the two never
   * drift apart. A desk with no analysts keeps the control visible but inert,
   * with a line saying why — a control that vanishes reads as a bug.
   */
  const depthControl = (
    <div className="flex flex-col gap-1" role="group" aria-label={t("market.depth.aria")} data-testid="market-depth">
      <span className="panel-label">{t("market.depth.label")}</span>
      {/* `w-fit self-start` keeps the pair hugging its two buttons: the column
          is a flex item beside the language select, and without it the track
          stretches to the row's full width. */}
      <div className="inline-flex w-fit self-start rounded-md border border-[var(--line)] p-0.5">
        {MARKET_DEPTHS.map((option) => (
          <button
            key={option}
            type="button"
            className={`rounded px-3 py-1 text-xs font-medium disabled:opacity-50 ${
              requestDepth === option ? "bg-[var(--accent-soft)] text-[var(--text)]" : "text-[var(--text-2)]"
            }`}
            aria-pressed={requestDepth === option}
            onClick={() => setDepth(option)}
            disabled={locked || (option === "team" && !teamReady)}
            data-testid={`market-depth-${option}`}
          >
            {t(`market.depth.${option}`)}
          </button>
        ))}
      </div>
      <span
        className="text-xs text-[var(--text-3)]"
        data-testid={teamReady ? "market-depth-hint" : "market-depth-unavailable"}
      >
        {teamReady ? t("market.depth.hint") : t("market.depth.unavailable")}
      </span>
    </div>
  );

  return (
    <main data-mode="market"
      className="mx-auto w-full max-w-[var(--content-wide)] px-6 pb-10 pt-8 text-[var(--text)]"
      data-testid="market-studio"
    >
      <div className="mb-5">
        <ModeHeader
          icon="market"
          title={t("market.studio.title")}
          outcome={t("market.studio.expectedInputs")}
          actions={
            result ? (
              <button
                type="button"
                onClick={() => void onDownload()}
                disabled={locked}
                className="btn btn-primary"
                data-testid="market-download"
              >
                {busy === "download" ? (
                  <>
                    {t("market.studio.building")}
                    <span className="pulse-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </>
                ) : (
                  t("market.studio.download")
                )}
              </button>
            ) : null
          }
        />
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
              <div className="mb-3 flex flex-wrap items-end gap-4">
                {specialistPicker}
                {depthControl}
              </div>
              <p className="text-xs text-[var(--text-3)]">{t("market.studio.startersLead")}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="card-live enter-rise px-3 py-1.5 text-left text-xs text-[var(--text)]"
                  style={{ "--i": 0 } as CSSProperties}
                  data-testid="market-specialist-starter"
                  title={specialistStarterTickers(specialist).join(", ")}
                  onClick={() => changeTickers(specialistStarterTickers(specialist))}
                  disabled={locked}
                >
                  <span className="font-medium">
                    {t("market.studio.specialistStarter", { label: specialistName(specialist) })}
                  </span>
                </button>
                {MARKET_STARTERS.map((starter, index) => (
                  <button
                    key={starter.id}
                    type="button"
                    className="card-live enter-rise px-3 py-1.5 text-left text-xs text-[var(--text)]"
                    style={{ "--i": index + 1 } as CSSProperties}
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
                {job.busy ? (
                  <>
                    {t("market.studio.writing")}
                    <span className="pulse-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </>
                ) : (
                  t("market.studio.writeBriefing")
                )}
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
              {depthControl}
              {specialistPicker}
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
                      onClick={() => setPrompt(defaultWatchPrompt(specialist, language))}
                      disabled={locked || prompt === defaultWatchPrompt(specialist, language)}
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
          <JobProgressList progress={teamProgress} busy={job.busy} testId="market-progress" />
        ) : null}
        {result ? (
          <div className="enter-rise space-y-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <h4 className="text-base font-medium text-[var(--text)]">{result.briefing.title}</h4>
              <span className="chip" data-testid="market-briefing-specialist">
                <span className="chip-dot" aria-hidden="true" />
                {specialistName(
                  isMarketSpecialist(result.briefing.specialist) ? result.briefing.specialist : specialist,
                )}
              </span>
            </div>
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
          </div>
        ) : null}
        {tickers.length === 0 && !job.busy ? (
          <div
            className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center text-[var(--text-2)]"
            data-testid="market-studio-empty"
          >
            <span className="icon-orb icon-orb-lg mx-auto">
              <ModeIcon name="market" size={24} strokeWidth={1.75} />
            </span>
            <p className="mt-4">{t("market.studio.empty")}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
