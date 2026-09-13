"use client";

import { useState } from "react";
import { FormattedText } from "@/components/formatted-text";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import { MarketTickerCard } from "@/components/market-ticker-card";
import { MacroTable, WatchlistTable } from "@/components/market-watch-tables";
import {
  collectFailures,
  formatObservedAt,
  isGuardedSection,
  sessionLabel,
  type GuardReport,
  type MarketBriefing,
  type MarketClock,
} from "@/lib/market-client";
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
  pre: "border-sky-300 bg-sky-50 text-sky-900",
  regular: "border-emerald-300 bg-emerald-50 text-emerald-900",
  post: "border-violet-300 bg-violet-50 text-violet-900",
  closed: "border-mist bg-mist/40 text-ink/70",
};

const H3 = "text-[14px] font-medium text-[var(--text)]";

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function ClockLine({ clock, testId }: { clock: MarketClock; testId: string }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/65" data-testid={testId}>
      <span
        className={`rounded-md border px-2 py-0.5 text-xs font-medium ${SESSION_BADGE[clock.usSession]}`}
        data-session={clock.usSession}
      >
        US {sessionLabel(clock.usSession)}
      </span>
      <span>Run {formatObservedAt(clock.runAt)}</span>
      {clock.note ? <span className="text-ink/55">— {clock.note}</span> : null}
    </p>
  );
}

function GuardLine({ guard, testId }: { guard: GuardReport; testId: string }) {
  if (guard.total === 0 && guard.adviceReplaced === 0) {
    return (
      <p className="mt-3 text-xs text-ink/55" data-testid={testId} data-clean="true">
        Every figure in this briefing traces to the fetched packet or your own position notes, and no sentence gives a
        directive.
      </p>
    );
  }
  return (
    <p
      className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      data-testid={testId}
      data-clean="false"
    >
      {pluralize(guard.total, "unverified figure")} replaced with “[unverified figure]”
      {guard.flagged.length > 0 ? `: ${guard.flagged.map((item) => item.text).join(", ")}` : ""}.{" "}
      {pluralize(guard.adviceReplaced, "sentence")} removed because {guard.adviceReplaced === 1 ? "it" : "they"} read as
      a directive.
    </p>
  );
}

function SourceList({ briefing, testId }: { briefing: MarketBriefing; testId: string }) {
  return (
    <section className="mt-10" data-testid={testId}>
      <h3 className={H3}>Sources</h3>
      {briefing.sources.length === 0 ? (
        <p className="mt-2 text-sm text-ink/55">No sources recorded.</p>
      ) : (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink/80">
          {briefing.sources.map((source) => {
            const href = safeLinkHref(source.url);
            return (
              <li key={`${source.url}|${source.label}`}>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                    {source.label}
                  </a>
                ) : (
                  <span>{source.label}</span>
                )}{" "}
                <span className="text-xs text-ink/50">observed {formatObservedAt(source.observedAt)}</span>
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
      className="rounded-xl border border-mist bg-paper px-8 py-10 shadow-sm"
      data-testid={`${testIdPrefix}-preview`}
      lang={briefing.language}
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink/45">Market Watch briefing</p>
      <h2 className="mt-2 text-3xl font-medium tracking-tight text-ink">{briefing.title}</h2>
      <ClockLine clock={packet.clock} testId={`${testIdPrefix}-clock`} />
      <GuardLine guard={guard} testId={`${testIdPrefix}-guard`} />
      {failures.length > 0 ? (
        <ul
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid={`${testIdPrefix}-failures`}
        >
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
                  className="rounded-md border border-mist px-3 py-1 text-xs font-medium text-ink disabled:opacity-50"
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  disabled={regeneratingIndex !== null}
                  data-testid={`${testIdPrefix}-section-regen`}
                >
                  {regeneratingIndex === index ? "Rewriting…" : "Rewrite"}
                </button>
              ) : null}
            </div>
            {isGuardedSection(section) ? (
              <p className="mt-2 text-[12px] text-amber-900" data-testid={`${testIdPrefix}-section-guarded`}>
                The advice guard replaced part of this section.
              </p>
            ) : null}
            <FormattedText text={section.body} className="mt-3 text-sm leading-relaxed text-ink/85" />
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
      <section className="mt-10">
        <h3 className={H3}>Watchlist</h3>
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
        <h3 className={H3}>Macro</h3>
        <div className="mt-3">
          <MacroTable macro={packet.macro} testId={`${testIdPrefix}-macro`} />
        </div>
      </section>
      {packet.positionContext ? (
        <section className="mt-10" data-testid={`${testIdPrefix}-position`}>
          <h3 className={H3}>Your position notes</h3>
          <pre className="mt-3 whitespace-pre-wrap rounded-md border border-mist bg-mist/30 px-3 py-2 font-sans text-sm text-ink/80">
            {packet.positionContext}
          </pre>
        </section>
      ) : null}
      <SourceList briefing={briefing} testId={`${testIdPrefix}-sources`} />
      <p
        className="mt-10 rounded-md border border-mist bg-mist/40 px-4 py-3 text-sm text-ink/80"
        data-testid={`${testIdPrefix}-disclaimer`}
      >
        {briefing.disclaimer}
      </p>
    </article>
  );
}
