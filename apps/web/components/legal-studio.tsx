"use client";

import { useEffect, useState } from "react";
import { MascotSlot } from "@/components/mascot-slot";
import {
  createLegalMatter,
  deleteLegalFile,
  getLegalMatter,
  getLegalRun,
  isDocxFile,
  LEGAL_FILE_MAX_BYTES,
  LegalRequestError,
  legalRunStreamPath,
  listLegalMatters,
  listLegalPlaybooks,
  parseLegalRunSummary,
  updateLegalMatter,
  uploadLegalFiles,
  type LegalMatterRecord,
  type LegalPlaybookSummary,
  type LegalRunSummary,
} from "@/lib/legal-client";
import {
  canRun,
  canUpload,
  DEFAULT_LEGAL_DRAFT,
  draftFromMatter,
  legalValidationKey,
  nextDocRole,
  type LegalDraft,
  type PendingUpload,
} from "@/lib/legal-view";
import { useJobModel } from "@/lib/use-job-model";
import { modelPickBody, studioModelPick } from "@/lib/model-choice";
import { useJobStream } from "@/lib/use-job-stream";
import { t } from "@/lib/i18n";
import { ModeHeader } from "@/components/mode-header";
import { SettingsLinkHint } from "@/components/settings-link-hint";
import { LegalMatterMap } from "@/components/legal-matter-map";
import { LegalMatterPanel } from "@/components/legal-matter-panel";
import { LegalResultView } from "@/components/legal-result-view";
import { LegalRunView } from "@/components/legal-run-view";

type Busy = "upload" | "open" | "save" | "next" | "roles" | null;

function untitled(): string {
  return t("legal.studio.untitled");
}

function needsSettingsHint(message: string, code?: string, status?: number): boolean {
  if (code === "runtime_stub" || code === "not_implemented" || status === 503 || status === 501) {
    return true;
  }
  return /gateway|api key|settings|runtime_stub|live gateway|not wired/i.test(message);
}

function message(err: unknown, fallback: string): string {
  if (err instanceof LegalRequestError) {
    const key = legalValidationKey(err.code, err.message);
    if (key) {
      return t(key);
    }
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Refuse what the host would refuse before the first upload creates a matter for it. */
function refusedUpload(files: readonly File[]): string | null {
  const notDocx = files.find((file) => !isDocxFile(file));
  if (notDocx) {
    return t("legal.errors.docxOnly");
  }
  const tooLarge = files.find((file) => file.size > LEGAL_FILE_MAX_BYTES);
  return tooLarge ? t("legal.errors.tooLarge", { name: tooLarge.name }) : null;
}

export function LegalStudio() {
  const { models, model, pinned: modelPinned, setModel } = useJobModel("legal");
  const [verifierModel, setVerifierModel] = useState("");
  const job = useJobStream<unknown>();
  const [draft, setDraft] = useState<LegalDraft>(DEFAULT_LEGAL_DRAFT);
  const [matter, setMatter] = useState<LegalMatterRecord | null>(null);
  const [matters, setMatters] = useState<LegalMatterRecord[]>([]);
  const [playbooks, setPlaybooks] = useState<LegalPlaybookSummary[]>([]);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [result, setResult] = useState<LegalRunSummary | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError ?? job.error?.message ?? null;
  const locked = job.busy || busy !== null;
  const docs = matter?.docs ?? [];
  const playbookTitle = playbooks.find((item) => item.id === draft.playbookId)?.title ?? null;
  const ready = canRun(draft, docs.length, busy === "upload");
  const uploadReady = canUpload(draft);

  useEffect(() => {
    let cancelled = false;
    void listLegalMatters().then(
      (list) => !cancelled && setMatters(list),
      () => undefined,
    );
    void listLegalPlaybooks().then(
      (list) => !cancelled && setPlaybooks(list),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshMatters() {
    setMatters(await listLegalMatters().catch(() => matters));
  }

  async function ensureMatter(): Promise<LegalMatterRecord> {
    if (matter) {
      return matter;
    }
    const created = await createLegalMatter({ ...draft, title: draft.title.trim() || untitled() });
    setMatter(created);
    return created;
  }

  async function onFiles(files: File[]) {
    if (locked) {
      return;
    }
    if (!uploadReady) {
      setLocalError(t("legal.files.needParties"));
      return;
    }
    const refused = refusedUpload(files);
    if (refused) {
      setLocalError(refused);
      return;
    }
    setBusy("upload");
    setLocalError(null);
    setPending(files.map((file) => ({ name: file.name, status: "queued" })));
    try {
      const target = await ensureMatter();
      const latest = await uploadLegalFiles(target.id, files, (progress) => {
        setPending((current) =>
          current.map((item, index) => (index === progress.index ? { ...item, status: progress.status } : item)),
        );
      });
      if (latest) {
        setMatter(latest);
      }
    } catch (err) {
      setLocalError(message(err, t("legal.errors.upload")));
      if (matter) {
        setMatter(await getLegalMatter(matter.id).catch(() => matter));
      }
    } finally {
      setPending([]);
      setBusy(null);
      void refreshMatters();
    }
  }

  async function onCycleRole(docId: string) {
    if (!matter || locked) {
      return;
    }
    const card = matter.docs.find((doc) => doc.id === docId);
    if (!card) {
      return;
    }
    const role = nextDocRole(card.role);
    setBusy("roles");
    setLocalError(null);
    try {
      setMatter(await updateLegalMatter(matter.id, { roles: [{ id: docId, role }] }));
    } catch (err) {
      setLocalError(message(err, t("legal.errors.role")));
    } finally {
      setBusy(null);
    }
  }

  async function onRemoveFile(docId: string) {
    if (!matter || locked) {
      return;
    }
    setBusy("save");
    setLocalError(null);
    try {
      setMatter(await deleteLegalFile(matter.id, docId));
    } catch (err) {
      setLocalError(message(err, t("legal.errors.remove")));
    } finally {
      setBusy(null);
    }
  }

  async function onRun() {
    if (!matter || !ready || locked) {
      return;
    }
    setBusy("save");
    setLocalError(null);
    let saved: LegalMatterRecord;
    try {
      saved = await updateLegalMatter(matter.id, { ...draft, title: draft.title.trim() || untitled() });
      setMatter(saved);
    } catch (err) {
      setLocalError(message(err, t("legal.errors.saveBeforeRun")));
      setBusy(null);
      return;
    }
    setBusy(null);
    // Only a deliberate pick travels as pinned: a seeded default stays rescuable by the host's fallback.
    // The verifier has no seeded default here (empty until the person picks one), so a value is a pick.
    const raw = await job.run(legalRunStreamPath(saved.id), {
      ...modelPickBody(studioModelPick(model, modelPinned)),
      ...(verifierModel ? { verifierModel, verifierModelPinned: true } : {}),
    });
    if (raw === null) {
      return;
    }
    try {
      setResult(parseLegalRunSummary(raw));
      setMatter(await getLegalMatter(saved.id).catch(() => saved));
      void refreshMatters();
    } catch (err) {
      setLocalError(message(err, t("legal.errors.readResult")));
    }
  }

  async function onOpen(matterId: string) {
    if (locked) {
      return;
    }
    setBusy("open");
    setLocalError(null);
    try {
      const opened = await getLegalMatter(matterId);
      const run = opened.lastRunId ? await getLegalRun(opened.id, opened.lastRunId) : null;
      job.reset();
      setMatter(opened);
      setDraft(draftFromMatter(opened));
      setResult(run);
      if (run?.error) {
        setLocalError(t("legal.errors.lastRun", { message: run.error.message }));
      }
    } catch (err) {
      setLocalError(message(err, t("legal.errors.openMatter")));
    } finally {
      setBusy(null);
    }
  }

  function onNewMatter() {
    job.reset();
    setMatter(null);
    setResult(null);
    setDraft(DEFAULT_LEGAL_DRAFT);
    setLocalError(null);
  }

  async function onNextTurn() {
    if (!matter || locked) {
      return;
    }
    setBusy("next");
    setLocalError(null);
    try {
      const base = draftFromMatter(matter);
      const created = await createLegalMatter({
        ...base,
        title: t("legal.studio.nextTurnTitle", { title: base.title }),
        priorMatterId: matter.id,
      });
      job.reset();
      setMatter(created);
      setDraft(draftFromMatter(created));
      setResult(null);
      void refreshMatters();
    } catch (err) {
      setLocalError(message(err, t("legal.errors.nextTurn")));
    } finally {
      setBusy(null);
    }
  }

  const screen = job.busy ? "running" : result ? "result" : "new";

  return (
    <div data-testid="legal-shell">
      <main
        data-mode="legal"
        className="mx-auto w-full max-w-[var(--content-wide)] px-6 pb-10 pt-8 text-[var(--text)]"
        data-testid="legal-studio"
        data-screen={screen}
      >
        <div className="mb-5">
          <ModeHeader
            icon="legal"
            title={t("legal.studio.title")}
            outcome={t("legal.studio.lede")}
            actions={
              screen === "new" ? (
                <>
                  {matters.length > 0 ? (
                    <select
                      className="input w-auto"
                      value=""
                      onChange={(event) => event.target.value && void onOpen(event.target.value)}
                      disabled={locked}
                      aria-label={t("legal.studio.reopenAria")}
                      data-testid="legal-reopen"
                    >
                      <option value="">{t("legal.studio.reopen")}</option>
                      {matters.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {matter ? (
                    <button type="button" className="btn" onClick={onNewMatter} disabled={locked}>
                      {t("legal.studio.newMatter")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => void onRun()}
                    disabled={!ready || locked}
                    title={ready ? undefined : t("legal.studio.runHint")}
                    data-testid="legal-run"
                  >
                    {busy === "save" ? (
                      <>
                        {t("legal.studio.saving")}
                        <span className="pulse-dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                      </>
                    ) : (
                      t("legal.studio.run")
                    )}
                  </button>
                </>
              ) : null
            }
          />
        </div>
        {error ? (
          <p className="mb-4 text-sm text-[var(--danger)]" role="alert" data-testid="legal-error">
            {error}
            {needsSettingsHint(error, job.error?.code, job.error?.status) && !/settings/i.test(error) ? (
              <>
                {" "}
                <SettingsLinkHint i18nKey="legal.studio.openSettings" />
              </>
            ) : null}
          </p>
        ) : null}

        {screen === "running" ? (
          <LegalRunView
            draft={draft}
            playbookTitle={playbookTitle}
            progress={job.progress}
            busy={job.busy}
            onCancel={job.cancel}
          />
        ) : null}

        {screen === "result" && result && matter ? (
          <div className="enter-rise">
            <LegalResultView
              title={matter.title}
              party={draft.side.party}
              result={result}
              locked={locked}
              onNextTurn={() => void onNextTurn()}
              onNewMatter={onNewMatter}
              onError={setLocalError}
            />
          </div>
        ) : null}

        {screen === "new" ? (
          <div className="grid items-start gap-5 lg:[grid-template-columns:minmax(0,1fr)_minmax(0,1fr)]">
            <div className="lg:col-span-2">
              <MascotSlot mode="legal" placement="empty" />
            </div>
            <LegalMatterPanel
              draft={draft}
              onDraft={setDraft}
              docs={docs}
              pending={pending}
              playbooks={playbooks}
              locked={locked}
              uploadReady={uploadReady}
              onFiles={(files) => void onFiles(files)}
              onCycleRole={(docId) => void onCycleRole(docId)}
              onRemoveFile={(docId) => void onRemoveFile(docId)}
            />
            <LegalMatterMap
              draft={draft}
              docs={docs}
              playbookTitle={playbookTitle}
              matters={matters}
              currentMatterId={matter?.id ?? null}
              models={models}
              model={model}
              verifierModel={verifierModel}
              locked={locked}
              onModel={setModel}
              onVerifierModel={setVerifierModel}
              onOpen={(id) => void onOpen(id)}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}
