import { replayGuide } from "@/lib/guide-store";
import { t } from "@/lib/i18n";

/**
 * "Replay the guide", on Settings. The first-run tour opens on its own once; this reopens it whenever
 * the person wants, and does not touch the record that says it has been seen.
 *
 * It does not navigate. The tour never moves the person between pages, so the composer stop is a
 * centred card here (Settings has no composer) and the same stop points at the real one when the
 * guide is replayed from Chat. Staying put is also what lets focus go back to this button when the
 * tour closes.
 */
export function SettingsGuideCard() {
  return (
    <section
      className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="settings-guide"
    >
      <div className="min-w-0 flex-1 basis-56">
        <h2 className="font-medium text-[var(--text)]">{t("guide.replay.title")}</h2>
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("guide.replay.body")}</p>
      </div>
      <button type="button" className="btn" data-testid="settings-guide-replay" onClick={() => replayGuide()}>
        {t("guide.replay.button")}
      </button>
    </section>
  );
}
