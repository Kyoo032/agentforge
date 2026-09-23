/**
 * `apps/web` runs vitest without a DOM, so the studio itself cannot be rendered here. These read
 * the component sources instead and pin the wiring a drive depends on: the spreadsheet upload
 * feeding the paste box, the export menu where the DOCX button used to be, and the report's charts
 * above the brief prose.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function read(relative: string): string {
  return readFileSync(resolve(here, relative), "utf8");
}

const studio = read("../components/finance-studio.tsx");
const inputs = read("../components/finance-steps/finance-inputs-panel.tsx");
const resultPanel = read("../components/finance-steps/finance-result-panel.tsx");
const fileUpload = read("../components/finance-file-upload.tsx");
const resultNotices = read("../components/finance-steps/finance-result-notices.tsx");
const useJobModel = read("./use-job-model.ts");

describe("finance inputs panel", () => {
  it("mounts the upload between the paste box and the dataset picker", () => {
    expect(inputs).toContain('import { FinanceFileUpload } from "@/components/finance-file-upload"');
    const uploadAt = inputs.indexOf("<FinanceFileUpload");
    expect(uploadAt).toBeGreaterThan(inputs.indexOf('data-testid="finance-parse"'));
    expect(uploadAt).toBeLessThan(inputs.indexOf('data-testid="finance-dataset"'));
  });

  it("feeds the paste box instead of bypassing parse and confirm", () => {
    expect(inputs).toContain("onFigures={(text, prose) => onFigures(mergeFigures(figures, text), prose)}");
    expect(inputs).toContain('import { mergeFigures } from "@/lib/finance-brief"');
    // An upload while a job runs would change the inputs under it.
    expect(inputs).toContain("<FinanceFileUpload");
    expect(inputs).toContain("disabled={locked}");
  });
});

describe("finance studio result area", () => {
  it("exports through the format menu, with the desk's remembered choice", () => {
    expect(studio).toContain('import { FinanceExportMenu } from "@/components/finance-export-menu"');
    expect(studio).toContain("<FinanceExportMenu");
    expect(studio).toContain("workspaceId={workspaceId}");
  });

  it("dropped the DOCX button: one export control, not two", () => {
    expect(studio).not.toContain("finance-download-docx");
    expect(studio).not.toContain("downloadFinanceDocx");
    expect(studio).not.toContain('t("finance.download")');
    expect(studio).not.toContain('t("finance.downloading")');
  });

  it("builds the report once and draws its charts above the prose", () => {
    expect(resultPanel).toContain("useMemo(");
    expect(resultPanel).toContain("financeReportFromBrief(result.brief, { task, locale, guard: result.guard })");
    expect(resultPanel.indexOf("<FinanceReportCharts")).toBeLessThan(resultPanel.indexOf("<FinanceBriefView"));
  });

  it("keeps the studio a shell the task steps hang off", () => {
    expect(studio).toContain('import { FinanceResultPanel } from "@/components/finance-steps/finance-result-panel"');
    expect(studio.split(/\r?\n/).length).toBeLessThan(400);
  });
});

describe("what the desk says about a finished run", () => {
  it("shows the hidden-identifier count and the stand-in model, both from locale strings", () => {
    expect(studio).toContain(
      'import { FinanceResultNotices } from "@/components/finance-steps/finance-result-notices"',
    );
    expect(studio).toContain("<FinanceResultNotices result={result} />");
    expect(resultNotices).toContain('data-testid="finance-result-pii"');
    expect(resultNotices).toContain('t("finance.notice.pii", { n: pii })');
    expect(resultNotices).toContain('data-testid="finance-result-model-fallback"');
    expect(resultNotices).toContain('t("finance.notice.modelFallback", { from: fallback.from, to: fallback.to })');
    // Both fields are optional on the wire, so nothing at all is drawn when neither is there.
    expect(resultNotices).toContain("if (pii === 0 && !fallback) {");
  });

  it("names each streamed phase instead of printing its id", () => {
    expect(studio).toContain('import { financePhaseLabel } from "@/lib/finance-phase-label"');
    expect(studio).toContain("labelFor={financePhaseLabel}");
  });
});

describe("what the upload says about the file it read", () => {
  it("lists the reader's warnings and the hidden identifiers, in the reader's language", () => {
    expect(fileUpload).toContain('import { financeWarningText } from "@/lib/finance-import-warnings"');
    expect(fileUpload).toContain('data-testid="finance-upload-warnings"');
    expect(fileUpload).toContain('data-testid="finance-upload-pii"');
    expect(fileUpload).toContain('t("finance.upload.pii", { n: result.pii.count })');
    // The host's developer English is never printed: the sentence comes from the code and a count.
    expect(fileUpload).not.toContain("warning.message");
    expect(fileUpload.indexOf("<ImportNotices")).toBeLessThan(fileUpload.indexOf('data-testid="finance-upload-use"'));
  });
});

describe("a pinned model is a choice, not a default", () => {
  it("pins only when the picker changes, and clears the pin on a mode switch", () => {
    expect(useJobModel).toContain("const [pinned, setPinned] = useState(false);");
    expect(useJobModel).toContain("setPinned(false);");
    expect(useJobModel).toContain("return { models, model, pinned, setModel: pickModel };");
    // The seeding effect must not go through the pinning setter.
    expect(useJobModel).toContain("setModel(seedJobModel({ models: list, catalogDefault, settingsModel }));");
  });

  it("sends modelPinned from the studio only when the person picked one", () => {
    expect(studio).toContain('const { models, model, pinned: modelPinned, setModel } = useJobModel("finance");');
    expect(studio).toContain("...(modelPinned ? { modelPinned: true } : {})");
    // The rewrite panel always sends its seeded model, so a rewrite is pinned only when the panel
    // moved off the studio's model or the studio's own pick was pinned (`regenModelPick`).
    expect(studio).toContain("...regenModelPick(payload.model, model, modelPinned),");
    expect(studio).not.toContain("modelPinned: Boolean(payload.model) || modelPinned");
  });
});
