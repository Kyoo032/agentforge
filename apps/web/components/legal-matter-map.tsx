"use client";

import type { MatterDocCard } from "@agentforge/core/legal";
import type { LegalMatterRecord } from "@/lib/legal-client";
import {
  formatDate,
  matterMapRows,
  roleLabel,
  whatWillHappen,
  WORK_TYPE_LABEL,
  type LegalDraft,
} from "@/lib/legal-view";
import type { JobStudioModel } from "@/lib/use-job-model";
import { ModelSelect } from "@/components/model-select";
import { DIM, LegalPanel, TD, TH } from "@/components/legal-parts";

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
  const steps = whatWillHappen(draft, docs.length, playbookTitle);
  const previous = matters.filter((item) => item.id !== currentMatterId).slice(0, MATTERS_SHOWN);

  return (
    <div className="space-y-4">
      <LegalPanel label="Matter map" aside="built from the files, editable" testId="legal-matter-map">
        {rows.length === 0 ? (
          <p className={`mt-2 text-sm ${DIM}`}>Upload the documents to build the map.</p>
        ) : (
          <table className="mt-2 w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Role</th>
                <th className={TH}>Document</th>
                <th className={TH}>Wins on conflict</th>
                <th className={TH}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.role} data-testid="legal-matter-map-row">
                  <td className={TD}>
                    <span className="tag tag-accent">{roleLabel(row.role)}</span>
                  </td>
                  <td className={TD}>{row.documents}</td>
                  <td className={`${TD} ${row.rank === "—" ? DIM : ""}`}>{row.rank}</td>
                  <td className={`${TD} ${DIM}`}>{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LegalPanel>

      <LegalPanel label="What will happen" testId="legal-plan">
        <ol className="mt-2 space-y-1.5 text-sm">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span className={`w-4 shrink-0 font-heading ${DIM}`}>{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className={`flex items-center gap-2 text-[11px] ${DIM}`}>
            Model
            <ModelSelect
              models={models}
              value={model}
              onChange={onModel}
              disabled={locked}
              testId="legal-studio-model"
              className="input w-auto px-2 py-1 text-[12px]"
            />
          </label>
          <label className={`flex items-center gap-2 text-[11px] ${DIM}`}>
            Verifier
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

      <LegalPanel label="Previous matters" testId="legal-previous">
        {previous.length === 0 ? (
          <p className={`mt-2 text-sm ${DIM}`}>No previous matters in this workspace.</p>
        ) : (
          <table className="mt-2 w-full border-collapse">
            <tbody>
              {previous.map((item) => (
                <tr key={item.id} data-testid="legal-previous-row">
                  <td className={TD}>{item.title}</td>
                  <td className={`${TD} ${DIM}`}>
                    {WORK_TYPE_LABEL[item.workType]} · {item.docs.length} {item.docs.length === 1 ? "file" : "files"}
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
                      Open
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
