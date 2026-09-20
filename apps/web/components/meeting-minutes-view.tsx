"use client";

import type { MeetingMinutes } from "@agentforge/core/meeting";
import { NEEDS_OWNER } from "@agentforge/core/meeting";
import { t } from "@/lib/i18n";

type Props = {
  minutes: MeetingMinutes;
  testId: string;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium tracking-[var(--track)] text-[var(--text)]">{title}</h3>
      <div className="mt-2 text-sm text-[var(--text-2)]">{children}</div>
    </section>
  );
}

export function MeetingMinutesView({ minutes, testId }: Props) {
  return (
    <article className="rounded-lg border border-[var(--line)] px-5 py-4" data-testid={testId}>
      <h2 className="text-lg font-medium text-[var(--text)]">{minutes.title}</h2>
      {minutes.heldOn ? <p className="mt-1 text-xs text-[var(--text-2)]">{minutes.heldOn}</p> : null}
      <p className="mt-3 text-sm text-[var(--text-2)]">{minutes.summary}</p>

      {minutes.attendees.length > 0 ? (
        <Section title={t("meeting.minutes.attendees")}>
          <ul className="space-y-1" data-testid={`${testId}-attendees`}>
            {minutes.attendees.map((attendee) => (
              <li key={attendee.name}>
                {attendee.name}
                {attendee.role ? <span className="text-[var(--text-3)]"> — {attendee.role}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {minutes.decisions.length > 0 ? (
        <Section title={t("meeting.minutes.decisions")}>
          <ul className="space-y-2" data-testid={`${testId}-decisions`}>
            {minutes.decisions.map((decision) => (
              <li key={decision.statement}>
                {decision.statement}
                {decision.provisional ? (
                  <span className="ml-2 text-xs text-[var(--text-3)]">{t("meeting.minutes.provisional")}</span>
                ) : null}
                {decision.context ? <div className="text-[var(--text-3)]">{decision.context}</div> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {minutes.actionItems.length > 0 ? (
        <Section title={t("meeting.minutes.actions")}>
          <table className="w-full text-left" data-testid={`${testId}-actions`}>
            <thead className="text-xs text-[var(--text-3)]">
              <tr>
                <th className="py-1 pr-3 font-normal">{t("meeting.minutes.action")}</th>
                <th className="py-1 pr-3 font-normal">{t("meeting.minutes.owner")}</th>
                <th className="py-1 font-normal">{t("meeting.minutes.due")}</th>
              </tr>
            </thead>
            <tbody>
              {minutes.actionItems.map((item) => (
                <tr key={`${item.task}-${item.owner}`} className="align-top">
                  <td className="py-1 pr-3">
                    {item.task}
                    {item.firstStep ? <div className="text-[var(--text-3)]">{item.firstStep}</div> : null}
                  </td>
                  <td className={`py-1 pr-3 ${item.owner === NEEDS_OWNER ? "text-[var(--danger)]" : ""}`}>
                    {item.owner}
                  </td>
                  <td className="py-1">{item.due || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {minutes.risks.length > 0 ? (
        <Section title={t("meeting.minutes.risks")}>
          <ul className="list-disc space-y-1 pl-5">
            {minutes.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {minutes.openQuestions.length > 0 ? (
        <Section title={t("meeting.minutes.questions")}>
          <ul className="list-disc space-y-1 pl-5">
            {minutes.openQuestions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}
