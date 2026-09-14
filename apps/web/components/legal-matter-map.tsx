"use client";

import { LEGAL_CAPS, type DocRole, type MatterDocCard } from "@agentforge/core/legal";
import type { LegalMatterRecord } from "@/lib/legal-client";
import {
  deliverableLabel,
  formatDate,
  matterMapRows,
  roleLabel,
  WORK_TYPE_LABEL,
  type LegalDraft,
} from "@/lib/legal-view";
import type { JobStudioModel } from "@/lib/use-job-model";
import { ModelSelect } from "@/components/model-select";
import { DIM, LegalPanel, TD, TH } from "@/components/legal-parts";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

function localizedRole(role: DocRole): string {
  return labeled(`legal.role.${role}`, roleLabel(role));
}

function localizedRank(rank: string): string {
  if (rank === "—") {
    return t("legal.rank.none");
  }
  if (rank === "last") {
    return t("legal.rank.last");
  }
  return rank;
}

function planSteps(draft: LegalDraft, docCount: number, playbookTitle: string | null): string[] {
  const filesWord = t(docCount === 1 ? "legal.files.file" : "legal.files.files");
  const files = `${docCount} ${filesWord}`;
  const side =
    draft.side.role === "other"
      ? draft.side.party || t("legal.plan.theClient")
      : t("legal.plan.theRole", { role: labeled(`legal.side.${draft.side.role}`, draft.side.role) });
  const playbook = playbookTitle ? t("legal.plan.andPlaybook", { title: playbookTitle }) : "";
  const work = labeled(`legal.workType.${draft.workType}`, WORK_TYPE_LABEL[draft.workType]);
  const deliverables =
    draft.deliverables.map((kind) => labeled(`legal.deliverable.${kind}`, deliverableLabel(kind))).join(", ") ||
    t("legal.plan.noFiles");
  return [
    t("legal.plan.ingest", { files }),
    t("legal.plan.review", { work, playbook, side }),
    t("legal.plan.draft", { deliverables }),
    t("legal.plan.verifyCode"),
    t("legal.plan.verifyModel", { rounds: LEGAL_CAPS.maxRounds }),
    t("legal.plan.deliver"),
  ];
}

type Props = {
  draft: LegalDraft;
  docs: readonly MatterDocCard[];
  playbookTitle: string | null;
  matters: readonly LegalMatterRecord[];
  currentMatterId: string | null;
  models: JobStudioModel[];
  model: string;
  verifierModel: string;
  locked: boolean;
  onModel: (id: string) => void;
  onVerifierModel: (id: string) => void;
  onOpen: (matterId: string) => void;
};

const MATTERS_SHOWN = 8;

/** Screen 1, right column: matter map, what will happen, previous matters. */
export function LegalMatterMap({
  draft,
  docs,
  playbookTitle,
  matters,
  currentMatterId,
  models,
  model,
  verifierModel,
  locked,
  onModel,
  onVerifierModel,
  onOpen,
}: Props) {
  const rows = matterMapRows(docs);
  const steps = planSteps(draft, docs.length, playbookTitle);
  const previous = matters.filter((item) => item.id !== currentMatterId).slice(0, MATTERS_SHOWN);

  return (
    <div className="space-y-4">
      <LegalPanel label={t("legal.map.title")} aside={t("legal.map.aside")} testId="legal-matter-map">
        {rows.length === 0 ? (
          <p className={`mt-2 text-sm ${DIM}`}>{t("legal.map.empty")}</p>
        ) : (
          <table className="mt-2 w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>{t("legal.map.role")}</th>
                <th className={TH}>{t("legal.map.document")}</th>
                <th className={TH}>{t("legal.map.wins")}</th>
                <th className={TH}>{t("legal.map.notes")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.role} data-testid="legal-matter-map-row">
                  <td className={TD}>
                    <span className="tag tag-accent">{localizedRole(row.role)}</span>
                  </td>
                  <td className={TD}>{row.documents}</td>
                  <td className={`${TD} ${row.rank === "—" ? DIM : ""}`}>{localizedRank(row.rank)}</td>
                  <td className={`${TD} ${DIM}`}>{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LegalPanel>

      <LegalPanel label={t("legal.plan.title")} testId="legal-plan">
        <ol className="mt-2 space-y-1.5 text-sm">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className={`w-4 shrink-0 font-heading ${DIM}`}>{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className={`flex items-center gap-2 text-xs ${DIM}`}>
            {t("legal.plan.model")}
            <ModelSelect
              models={models}
              value={model}
              onChange={onModel}
              disabled={locked}
              testId="legal-studio-model"
              className="input w-auto px-2 py-1 text-[12px]"
            />
          </label>
          <label className={`flex items-center gap-2 text-xs ${DIM}`}>
            {t("legal.plan.verifier")}
            <ModelSelect
              models={models}
              value={verifierModel || model}
              onChange={onVerifierModel}
              disabled={locked}
              testId="legal-studio-verifier-model"
              className="input w-auto px-2 py-1 text-[12px]"
            />
          </label>
        </div>
      </LegalPanel>

      <LegalPanel label={t("legal.previous.title")} testId="legal-previous">
        {previous.length === 0 ? (
          <p className={`mt-2 text-sm ${DIM}`}>{t("legal.previous.empty")}</p>
        ) : (
          <table className="mt-2 w-full border-collapse">
            <tbody>
              {previous.map((item) => (
                <tr key={item.id} data-testid="legal-previous-row">
                  <td className={TD}>{item.title}</td>
                  <td className={`${TD} ${DIM}`}>
                    {t("legal.previous.meta", {
                      work: labeled(`legal.workType.${item.workType}`, WORK_TYPE_LABEL[item.workType]),
                      count: item.docs.length,
                      filesWord: t(item.docs.length === 1 ? "legal.files.file" : "legal.files.files"),
                    })}
                  </td>
                  <td className={`${TD} ${DIM}`}>{formatDate(item.updatedAt)}</td>
                  <td className={`${TD} text-right`}>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1 text-[12px]"
                      onClick={() => onOpen(item.id)}
                      disabled={locked}
                      data-testid={`legal-open-${item.id}`}
                    >
                      {t("legal.previous.open")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LegalPanel>
    </div>
  );
}
