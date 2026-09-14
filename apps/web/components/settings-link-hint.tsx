import { Link } from "@/lib/nav";
import { t } from "@/lib/i18n";

const MARKER = "\u0001";

/** Renders a catalog string that contains `{settings}` as a Settings link. */
export function SettingsLinkHint({
  i18nKey,
  vars,
  testId,
}: {
  i18nKey: string;
  vars?: Record<string, string | number>;
  testId?: string;
}) {
  const text = t(i18nKey, { ...vars, settings: MARKER });
  const idx = text.indexOf(MARKER);
  const label = t("rail.settings");
  if (idx < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, idx)}
      <Link href="/settings" className="underline" data-testid={testId}>
        {label}
      </Link>
      {text.slice(idx + MARKER.length)}
    </>
  );
}
