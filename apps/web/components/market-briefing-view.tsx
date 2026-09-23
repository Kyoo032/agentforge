"use client";

import { useState } from "react";
import { FormattedText } from "@/components/formatted-text";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import { MarketTeamPanel } from "@/components/market-team-panel";
import { MarketTickerCard } from "@/components/market-ticker-card";
import { MacroTable, WatchlistTable } from "@/components/market-watch-tables";
import {
  collectFailures,
  formatObservedAt,
  isGuardedSection,
  type GuardReport,
  type MarketBriefing,
  type MarketClock,
} from "@/lib/market-client";
import { t } from "@/lib/i18n";
import { safeLinkHref } from "@/lib/safe-link";
import type { JobStudioModel } from "@/lib/use-job-model";

type Props = {
  briefing: MarketBriefing;
  guard: GuardReport;
  models?: JobStudioModel[];
  defaultModel?: string;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number, payload: JobRegenSubmit) => void;
  testIdPrefix?: string;
};

const SESSION_BADGE: Record<MarketClock["usSession"], string> = {
  pre: "border-[var(--line)] bg-[var(--accent-soft)] text-[var(--text)]",
  regular: "border-[var(--line)] bg-[var(--accent-soft)] text-[var(--text)]",
  post: "border-[var(--line)] bg-[var(--accent-soft)] text-[var(--text)]",
  closed: "border-[var(--line)] text-[var(--text-2)]",
};

const H3 = "text-sm font-semibold text-[var(--text)]";
const BANNER = "rounded-lg border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 text-xs text-[var(--text)]";

function counted(count: number, one: string, many: string): string {
  return t(count === 1 ? one : many, { count });
}

function ClockLine({ clock, testId }: { clock: MarketClock; testId: string }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--text-2)]" data-testid={testId}>
      <span
        className={`rounded-md border px-2 py-0.5 text-xs font-medium ${SESSION_BADGE[clock.usSession]}`}
        data-session={clock.usSession}
      >
        {t("market.briefing.usSession", { session: t(`market.session.${clock.usSession}`) })}
      </span>
      <span>{t("market.briefing.run", { when: formatObservedAt(clock.runAt) })}</span>
      {clock.note ? <span className="text-[var(--text-3)]">— {clock.note}</span> : null}
    </p>
  );
}

function GuardLine({ guard, testId }: { guard: GuardReport; testId: string }) {
  if (guard.total === 0 && guard.adviceReplaced === 0) {
    return (
      <p className="mt-3 text-xs text-[var(--text-3)]" data-testid={testId} data-clean="true">
        {t("market.briefing.guardClean")}
      </p>
    );
  }
  return (
    <p className={`mt-3 ${BANNER}`} data-testid={testId} data-clean="false">
      {t("market.briefing.guardDirty", {
        figures: counted(guard.total, "market.briefing.unverifiedOne", "market.briefing.unverifiedMany"),
        flagged: guard.flagged.length > 0 ? `: ${guard.flagged.map((item) => item.text).join(", ")}` : "",
        sentences: counted(guard.adviceReplaced, "market.briefing.sentenceOne", "market.briefing.sentenceMany"),
        pronoun: t(guard.adviceReplaced === 1 ? "market.briefing.pronounOne" : "market.briefing.pronounMany"),
      })}
    </p>
  );
}

function SourceList({ briefing, testId }: { briefing: MarketBriefing; testId: string }) {
  return (
    <section className="mt-10" data-testid={testId}>
      <h3 className={H3}>{t("market.briefing.sources")}</h3>
      {briefing.sources.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-3)]">{t("market.briefing.noSources")}</p>
      ) : (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-[var(--text-2)]">
          {briefing.sources.map((source) => {
            const href = safeLinkHref(source.url);
            return (
              <li key={`${source.url}|${source.label}`}>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    {source.label}
                  </a>
                ) : (
                  <span>{source.label}</span>
                )}{" "}
                <span className="text-xs text-[var(--text-3)]">
                  {t("market.briefing.observed", { when: formatObservedAt(source.observedAt) })}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function MarketBriefingView({
  briefing,
  guard,
  models = [],
  defaultModel = "",
  regeneratingIndex = null,
  onRegenerate,
  testIdPrefix = "market",
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const failures = collectFailures(briefing.packet);
  const { packet } = briefing;

  return (
    <article
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-8 py-10"
      data-testid={`${testIdPrefix}-preview`}
      lang={briefing.language}
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-3)]">
        {t("market.briefing.kicker")}
      </p>
      <h2 className="mt-2 text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{briefing.title}</h2>
      <ClockLine clock={packet.clock} testId={`${testIdPrefix}-clock`} />
      <GuardLine guard={guard} testId={`${testIdPrefix}-guard`} />
      {failures.length > 0 ? (
        <ul className={`mt-3 ${BANNER}`} data-testid={`${testIdPrefix}-failures`}>
          {failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-10 space-y-8">
        {briefing.sections.map((section, index) => (
          <section key={`${section.heading}|${section.body.slice(0, 48)}`} data-testid={`${testIdPrefix}-section`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className={H3}>{section.heading}</h3>
              {onRegenerate ? (
                <button
                  type="button"
                  className="rounded-md border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--text)] disabled:opacity-50"
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  disabled={regeneratingIndex !== null}
                  data-testid={`${testIdPrefix}-section-regen`}
                >
                  {t(regeneratingIndex === index ? "market.briefing.rewriting" : "market.briefing.rewrite")}
                </button>
              ) : null}
            </div>
            {isGuardedSection(section) ? (
              <p className="mt-2 text-xs text-[var(--text-2)]" data-testid={`${testIdPrefix}-section-guarded`}>
                {t("market.briefing.guardedSection")}
              </p>
            ) : null}
            <FormattedText text={section.body} className="mt-3 text-sm leading-relaxed text-[var(--text-2)]" />
            {onRegenerate && openIndex === index ? (
              <JobRegenPanel
                testIdPrefix="market"
                models={models}
                defaultModel={defaultModel}
                submitting={regeneratingIndex === index}
                onCancel={() => setOpenIndex(null)}
                onSubmit={(payload) => {
                  setOpenIndex(null);
                  onRegenerate(index, payload);
                }}
              />
            ) : null}
          </section>
        ))}
      </div>
      {/*
       * Only a team-depth run carries `team`; a quick briefing has nothing to
       * show here, so the panel is absent rather than empty. It sits between
       * the narrative and the data tables: the workings behind the sections
       * just read, above the packet the workings were drawn from.
       */}
      {briefing.team ? (
        <div className="mt-10">
          <MarketTeamPanel team={briefing.team} language={briefing.language} testIdPrefix={`${testIdPrefix}-team`} />
        </div>
      ) : null}
      <section className="mt-10">
        <h3 className={H3}>{t("market.briefing.watchlist")}</h3>
        <div className="mt-3">
          <WatchlistTable tickers={packet.tickers} testId={`${testIdPrefix}-watchlist`} />
        </div>
      </section>
      <section className="mt-8 space-y-4">
        {packet.tickers.map((ticker) => (
          <MarketTickerCard key={ticker.symbol.yahoo} ticker={ticker} testIdPrefix={testIdPrefix} />
        ))}
      </section>
      <section className="mt-10">
        <h3 className={H3}>{t("market.briefing.macro")}</h3>
        <div className="mt-3">
          <MacroTable macro={packet.macro} testId={`${testIdPrefix}-macro`} />
        </div>
      </section>
      {packet.positionContext ? (
        <section className="mt-10" data-testid={`${testIdPrefix}-position`}>
          <h3 className={H3}>{t("market.briefing.positionNotes")}</h3>
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-[var(--line)] bg-[var(--accent-soft)] px-3 py-2 font-sans text-sm text-[var(--text-2)]">
            {packet.positionContext}
          </pre>
        </section>
      ) : null}
      <SourceList briefing={briefing} testId={`${testIdPrefix}-sources`} />
      <p
        className="mt-10 rounded-md border border-[var(--line)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--text-2)]"
        data-testid={`${testIdPrefix}-disclaimer`}
      >
        {briefing.disclaimer}
      </p>
    </article>
  );
}
