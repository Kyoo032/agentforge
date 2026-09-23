import { t } from "@/lib/i18n";
import type { OnboardingDesk } from "@/lib/onboarding-desks";

type Props = {
  desks: OnboardingDesk[];
  busy: boolean;
  onOpen: (id: string) => void;
};

/** The other desks, on the key screen. Renders nothing on a one-desk install. */
export function OnboardingDesks({ desks, busy, onOpen }: Props) {
  if (desks.length === 0) {
    return null;
  }
  return (
    <section className="mt-8 border-t border-[var(--line)] pt-4" data-testid="onboarding-desks">
      <p className="text-sm text-[var(--text-2)]">{t("onboarding.desks.title")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {desks.map((desk) => (
          <button
            key={desk.id}
            type="button"
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--text)] disabled:opacity-50"
            onClick={() => onOpen(desk.id)}
            disabled={busy}
            data-testid="onboarding-open-desk"
            data-workspace-id={desk.id}
          >
            {desk.name}
          </button>
        ))}
      </div>
    </section>
  );
}
