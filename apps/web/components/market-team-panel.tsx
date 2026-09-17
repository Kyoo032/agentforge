"use client";

/**
 * The analyst team's working notes, under the briefing.
 *
 * A team run is up to eight model calls the reader paid for, and the briefing only
 * carries their conclusion. This panel is the audit trail: what each of the
 * four analysts saw, how the bull and the bear argued, and how the same picture
 * reads through three risk lenses. It is collapsed by default — the briefing is
 * the deliverable, these are the workings.
 *
 * Every string here is model output that the host has already put through the
 * number guard, the advice guard, the injection scan and the PII mask. It is
 * still rendered as plain text: no markdown pass, no raw-HTML escape hatch.
 * React escapes text nodes, so a note that contains markup is shown as the
 * characters the model wrote rather than acted on — and the wiring test greps
 * this file for both escape hatches by name, so neither can creep back in.
 */

import { useState } from "react";
import {
  MARKET_ANALYSTS,
  TEAM_SECTION_KEYS,
  teamSectionHeadings,
  type AnalystNote,
  type DebateSide,
  type MarketAnalyst,
  type RiskLens,
  type TeamNotes,
  type TeamSectionKey,
  type WatchLanguage,
} from "@/lib/market-client";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type Props = {
  team: TeamNotes;
  /** The briefing's own language, so the panel headings read like its sections. */
  language: WatchLanguage;
  testIdPrefix?: string;
};


const H3 = "text-sm font-semibold text-[var(--text)]";
const H4 = "text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]";
const CARD = "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3";
const BULLETS = "mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--text-2)]";

/** Confidence is the analyst's own, not a score we computed; the chip says which of the three. */
const CONFIDENCE_TONE: Readonly<Record<AnalystNote["confidence"], string>> = Object.freeze({
  low: "border-[var(--line)] text-[var(--text-3)]",
  medium: "border-[var(--line)] text-[var(--text-2)]",
  high: "border-[var(--line)] bg-[var(--accent-soft)] text-[var(--text)]",
});

function Bullets({ items }: { items: readonly string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <ul className={BULLETS}>
      {items.map((item, index) => (
        <li key={`${index}-${item.slice(0, 40)}`}>{item}</li>
      ))}
    </ul>
  );
}

function AnalystCard({ note, testId }: { note: AnalystNote; testId: string }) {
  return (
    <section className={CARD} data-testid={testId} data-confidence={note.confidence}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className={H4}>{t(`market.team.analysts.${note.analyst}`)}</h4>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${CONFIDENCE_TONE[note.confidence]}`}
          title={t("market.team.confidence.label")}
        >
          {t(`market.team.confidence.${note.confidence}`)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">{note.summary}</p>
      <Bullets items={note.keyPoints} />
    </section>
  );
}

function DebateColumn({ side, heading, testId }: { side: DebateSide; heading: string; testId: string }) {
  return (
    <section className={CARD} data-testid={testId} data-stance={side.stance}>
      <h4 className={H4}>{heading}</h4>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">{side.thesis}</p>
      <Bullets items={side.points} />
      {side.rebuttals.length > 0 ? (
        <>
          <p className="mt-3 text-xs font-medium text-[var(--text-3)]">{t("market.team.rebuttals")}</p>
          <Bullets items={side.rebuttals} />
        </>
      ) : null}
    </section>
  );
}

function LensCard({ lens, testId }: { lens: RiskLens; testId: string }) {
  return (
    <section className={CARD} data-testid={testId} data-lens={lens.lens}>
      <h4 className={H4}>{t(`market.team.lenses.${lens.lens}`)}</h4>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">{lens.view}</p>
      <Bullets items={lens.keyRisks} />
    </section>
  );
}

export function MarketTeamPanel({ team, language, testIdPrefix = "market-team" }: Props) {
  const [open, setOpen] = useState(false);

  /*
   * The synthesis wrote its sections under core's own headings, so the panel
   * labels the same four blocks with the same words: the catalog first, and
   * core's heading for the briefing's language behind it when a key is
   * missing. `market-locale-catalog.test.ts` pins the two together, so the
   * fallback is a safety net rather than a second wording.
   */
  const coreHeadings = teamSectionHeadings(language);
  const heading = (key: TeamSectionKey, catalogKey: string): string =>
    labeled(catalogKey, coreHeadings[TEAM_SECTION_KEYS.indexOf(key)] ?? "");

  /*
   * Core fixes the analyst order, so the cards keep it whatever order the host
   * happened to finish the calls in. A desk that runs fewer than four analysts
   * — or one whose analyst failed and was dropped — simply shows fewer cards.
   */
  const notes: AnalystNote[] = MARKET_ANALYSTS.map((analyst: MarketAnalyst) =>
    team.analysts.find((note) => note.analyst === analyst),
  ).filter((note): note is AnalystNote => note !== undefined);

  return (
    <section
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-6 py-5"
      data-testid={testIdPrefix}
      data-open={open ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={H3}>{t("market.team.title")}</h3>
        <button
          type="button"
          className="rounded-md border border-[var(--line)] px-3 py-1 text-xs font-medium text-[var(--text)]"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          data-testid={`${testIdPrefix}-toggle`}
        >
          {open ? t("market.team.hide") : t("market.team.show")}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-6">
          <div>
            <h4 className={H4}>{heading("analystNotes", "market.team.notes")}</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {notes.map((note) => (
                <AnalystCard key={note.analyst} note={note} testId={`${testIdPrefix}-analyst-${note.analyst}`} />
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DebateColumn side={team.bull} heading={heading("bull", "market.team.bull")} testId={`${testIdPrefix}-bull`} />
            <DebateColumn side={team.bear} heading={heading("bear", "market.team.bear")} testId={`${testIdPrefix}-bear`} />
          </div>

          <div>
            <h4 className={H4}>{heading("risk", "market.team.risk")}</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {team.risk.lenses.map((lens) => (
                <LensCard key={lens.lens} lens={lens} testId={`${testIdPrefix}-risk-${lens.lens}`} />
              ))}
            </div>
            <dl className="mt-3 space-y-1 text-sm text-[var(--text-2)]">
              <div className="flex flex-wrap gap-2">
                <dt className="font-medium text-[var(--text-3)]">{t("market.team.volatility")}</dt>
                <dd>{team.risk.volatility}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="font-medium text-[var(--text-3)]">{t("market.team.liquidity")}</dt>
                <dd>{team.risk.liquidity}</dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </section>
  );
}
