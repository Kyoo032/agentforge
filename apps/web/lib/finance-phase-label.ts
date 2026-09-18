/**
 * The job stream carries a phase *id* as its label ("narrate-guard-export"), because the host runs
 * where there is no locale to name it in. The phase strip beside the progress list already names
 * those ids, so the list looks the same string up rather than printing the id at the owner.
 *
 * Anything that is not one of Finance's own phase ids is left exactly as the host wrote it: other
 * job modes send real sentences through the same list.
 */
import { isFinancePhase } from "./finance-task";
import { t } from "./i18n";

export function financePhaseLabel(label: string): string {
  const id = label.trim();
  return isFinancePhase(id) ? t(`finance.phases.${id}`) : label;
}
