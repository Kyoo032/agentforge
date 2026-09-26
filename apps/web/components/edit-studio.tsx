"use client";

import {
  applyOp,
  emptyProject,
  STARTER_PROJECTS,
  type ApplyableOp,
  type EditOp,
  type EditProject,
} from "@agentforge/core/edit";
import { formatUsd } from "@agentforge/core/gateway";
import { EditAgentPanel } from "@/components/edit-agent-panel";
import { EditGenerateTab } from "@/components/edit-generate-tab";
import { FfmpegSetupNotice } from "@/components/ffmpeg-setup-notice";
import { ModeHeader } from "@/components/mode-header";
import { ModeIllustration } from "@/components/mode-illustration";
import { WorkingStatus } from "@/components/working-status";
import { imageClipAt } from "@/lib/edit-preview-media";
import { EditRecipesPanel } from "@/components/edit-recipes-panel";
import { EditPreview } from "@/components/edit-preview";
import { EditTimeline } from "@/components/edit-timeline";
import { apiFetch, isElectron } from "@/lib/api-client";
import { pickMedia } from "@/lib/desktop-bridge";
import { hasNativeFilePicker, useHostCapabilities } from "@/lib/host-capabilities";
import {
  activeJobs,
  createEditProject,
  errorMessage,
  fetchEditDoctor,
  type EditDoctor,
  fetchEditProject,
  fetchEditProjects,
  foldApplied,
  isReviewOpen,
  postEditOps,
  readJson,
  timelineEndFrame,
  turnSpendUsd,
  type EditJob,
  type EditProjectRow,
  type OpCard,
  type UnplacedItem,
} from "@/lib/edit-client";
import { consumeSse } from "@/lib/sse-client";
import { isEditShortcutIgnored, isInHiddenPane } from "@/lib/shortcut-target";
import { useEmitLock } from "@/lib/use-emit-lock";
import { useProductBrand } from "@/lib/product-brand";
import { t } from "@/lib/i18n";
import { Link } from "@/lib/nav";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

type ToolId = "upload" | "generate" | "ingredients" | "titles" | "captions" | "recipes" | "history";

const TOOLS: { id: ToolId }[] = [
  { id: "upload" },
  { id: "generate" },
  { id: "ingredients" },
  { id: "titles" },
  { id: "captions" },
  { id: "recipes" },
  { id: "history" },
];

type StudioModel = { id: string; label: string; provider?: string; inputModalities: string[]; contextLength?: number };

export function EditStudio() {
  const { gatewayName } = useProductBrand();
  const capabilities = useHostCapabilities();
  const emitLock = useEmitLock();
  const fileRef = useRef<HTMLInputElement>(null);
  const eventsAbort = useRef<AbortController | null>(null);
  const agentAbort = useRef<AbortController | null>(null);
  const lastAgentSeq = useRef(0);
  const covered = useRef<Set<number>>(new Set());
  const ackSentFor = useRef(-1);

  const [items, setItems] = useState<EditProjectRow[]>([]);
  const [project, setProject] = useState<EditProject | null>(null);
  const [cards, setCards] = useState<OpCard[]>([]);
  const [jobs, setJobs] = useState<EditJob[]>([]);
  const [unplaced, setUnplaced] = useState<UnplacedItem[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [opsPosted, setOpsPosted] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolId>("upload");
  const [projectName, setProjectName] = useState("Loop 1");
  const [starterId, setStarterId] = useState(STARTER_PROJECTS[0]?.id ?? "blank-16x9");
  const [tier, setTier] = useState("standard");
  const [hasKey, setHasKey] = useState(true);
  const [doctor, setDoctor] = useState<EditDoctor | null>(null);
  const [spendCap, setSpendCap] = useState(2);
  const [models, setModels] = useState<StudioModel[]>([]);
  const [imageModels, setImageModels] = useState<StudioModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [composerPrefill, setComposerPrefill] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const result = await fetchEditProjects();
      if (result.status !== 404) {
        setItems(result.items);
      }
    } catch {
      // host route may still be landing
    }
  }, []);

  const applyLoaded = useCallback(
    (loaded: { project: EditProject; cards: OpCard[]; jobs: EditJob[]; unplaced: UnplacedItem[]; seq: number }) => {
      setProject(loaded.project);
      setCards((current) => mergeCards(current, loaded.cards));
      setJobs(loaded.jobs);
      setUnplaced(loaded.unplaced.filter((item) => !item.discardedAt && !item.placedClipId));
      setClock(loaded.project.seq);
      lastAgentSeq.current = loaded.project.review.lastAgentSeq;
    },
    [],
  );

  const reloadProject = useCallback(
    async (id: string) => {
      const { loaded } = await fetchEditProject(id);
      if (loaded) {
        applyLoaded(loaded);
      }
    },
    [applyLoaded],
  );

  useEffect(() => {
    void loadList();
    void fetchEditDoctor().then((report) => {
      if (report) {
        setDoctor(report);
      }
    });
    void apiFetch("/api/v1/settings")
      .then((res) => res.json())
      .then((payload) => {
        setHasKey(Boolean(payload.hasOpenai));
        if (typeof payload.editTurnCapUsd === "number") {
          setSpendCap(Math.min(50, Math.max(0.5, payload.editTurnCapUsd)));
        }
      })
      .catch(() => undefined);
    void apiFetch("/api/v1/videos")
      .then((res) => res.json())
      .then((payload) => {
        if (Array.isArray(payload.models)) {
          setModels(payload.models);
        }
        if (payload.ready === false) {
          setHasKey(false);
        }
      })
      .catch(() => undefined);
    void apiFetch("/api/v1/images")
      .then((res) => res.json())
      .then((payload) => {
        if (Array.isArray(payload.models)) {
          setImageModels(payload.models);
        }
      })
      .catch(() => undefined);
  }, [loadList]);

  useEffect(() => {
    eventsAbort.current?.abort();
    if (!project?.id) {
      return;
    }
    const abort = new AbortController();
    eventsAbort.current = abort;
    void (async () => {
      try {
        const response = await apiFetch(`/api/v1/edit/projects/${project.id}/events`, { signal: abort.signal });
        if (!response.ok || !response.body) {
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!abort.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = consumeSse(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            const type = event.type;
            const record = event as unknown as Record<string, unknown>;
            if (type === "ops.appended" || type === "edit.ops") {
              const ops = (record.ops ?? record.applied) as EditOp[] | undefined;
              if (Array.isArray(ops) && ops.length > 0) {
                setProject((current) => (current ? foldApplied(current, ops) : current));
                const last = ops[ops.length - 1];
                if (last) {
                  setParent(last.id);
                  setClock(last.clock);
                }
              }
            }
            if (type === "card.updated" || type === "edit.card") {
              const card = (record.card ?? record) as OpCard;
              if (card && (typeof card.id === "string" || card.verb)) {
                setCards((current) => upsertCard(current, card));
              }
              emitLock.onCard();
            }
            if (type === "job.progress" || type === "job.done" || type === "edit.job") {
              const job = (record.job ?? record) as EditJob;
              if (job && typeof job.id === "string") {
                setJobs((current) => {
                  const rest = current.filter((item) => item.id !== job.id);
                  return [...rest, job];
                });
              }
            }
            if (type === "tool.started") {
              const touching = Array.isArray(record.touching) ? (record.touching as string[]) : undefined;
              const toolKey = typeof record.toolKey === "string" ? record.toolKey : "";
              const jobPending = Boolean(record.jobPending) || /generate_|transcribe|export/.test(toolKey);
              emitLock.onToolStarted(touching, { jobPending });
            }
          }
        }
      } catch {
        // aborted or host not ready
      }
    })();
    return () => abort.abort();
  }, [emitLock, project?.id]);

  async function commitOps(ops: ApplyableOp[]) {
    if (!project) {
      return;
    }
    setError(null);
    try {
      const result = await postEditOps({ project, parent, clock, opsPosted }, ops);
      setProject(result.project);
      setParent(result.parent);
      setClock(result.clock);
      setOpsPosted(result.opsPosted);
      if (result.error) {
        setError(result.error);
        await reloadProject(project.id);
        return;
      }
      for (const cardId of [...new Set(result.keepCardIds)]) {
        await apiFetch(`/api/v1/edit/projects/${project.id}/cards/${cardId}/keep`, { method: "POST" }).catch(
          () => undefined,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("edit.errors.apply"));
    }
  }

  async function onNewProject() {
    const name = projectName.trim() || "Untitled";
    const created = await createEditProject(name, projectAspectFromStarter(starterId), starterId);
    if (created.error || !created.project) {
      if (created.status === 404) {
        const local = emptyProject({
          id: crypto.randomUUID(),
          workspaceId: "local",
          name,
          aspect: "16:9",
        });
        setProject(local);
        setCards([]);
        setJobs([]);
        setUnplaced([]);
        return;
      }
      setError(created.error ?? t("edit.errors.createProject"));
      return;
    }
    const { loaded } = await fetchEditProject(created.project.id);
    if (loaded) {
      applyLoaded(loaded);
    } else {
      setProject(created.project);
    }
    await loadList();
  }

  async function onImportFile(file: File) {
    if (!project) {
      return;
    }
    const form = new FormData();
    form.set("file", file);
    const response = await apiFetch(`/api/v1/edit/projects/${project.id}/import`, { method: "POST", body: form });
    const payload = await readJson(response);
    if (!response.ok) {
      setError(errorMessage(payload, t("edit.errors.import")));
      return;
    }
    if (payload.op) {
      setProject((current) => (current ? applyOp(current, payload.op as ApplyableOp) : current));
      setOpsPosted((count) => count + 1);
    }
    await reloadProject(project.id);
  }

  async function onImportClick() {
    /*
     * Phase 8 — the native picker is a capability now, not just a bridge check.
     *
     * `isElectron()` alone was almost right and said the wrong thing: it is false on webdev as
     * well as on the hosted server, so it was really testing "is this the packaged app". What this
     * branch actually needs is "may a path on this machine mean anything to the host", which is
     * what `nativeFilePicker` says, and the host refuses a `sourcePath` in server mode with
     * `local_path_disabled` whatever the renderer decides. Both halves, because neither is enough:
     * the flag alone would offer a picker on webdev, where there is no shell to ask.
     */
    if (hasNativeFilePicker(capabilities) && project) {
      try {
        const [sourcePath] = await pickMedia();
        if (!sourcePath) {
          return;
        }
        const response = await apiFetch(`/api/v1/edit/projects/${project.id}/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourcePath }),
        });
        if (!response.ok) {
          setError(errorMessage(await readJson(response), t("edit.errors.import")));
          return;
        }
        await reloadProject(project.id);
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : t("edit.errors.import"));
        return;
      }
    }
    fileRef.current?.click();
  }

  const projectRef = useRef(project);
  projectRef.current = project;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const selectedRef = useRef(selectedClipId);
  selectedRef.current = selectedClipId;
  const commitRef = useRef(commitOps);
  commitRef.current = commitOps;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isInHiddenPane(document.querySelector<HTMLElement>("[data-testid='edit-studio']"))) {
        return;
      }
      // A focused field, select, button or key-taking widget keeps its own keys (Space presses a
      // button, arrows move a select), and a chord such as Ctrl/Cmd+S or +K is never split/play.
      if (isEditShortcutIgnored(event)) {
        return;
      }
      const current = projectRef.current;
      const fps = current?.fps ?? 30;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
        return;
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        const clip = current?.clips.find((item) => item.id === selectedRef.current);
        const at = playheadRef.current;
        if (clip && at > clip.timelineStartFrame && at < clip.timelineStartFrame + clip.durationFrames) {
          void commitRef.current([
            { type: "split_clip", payload: { clipId: clip.id, atFrame: at, newClipId: crypto.randomUUID() } },
          ]);
        }
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const clipId = selectedRef.current;
        if (clipId) {
          void commitRef.current([{ type: "delete_clip", payload: { clipId } }]);
          setSelectedClipId(null);
        }
        return;
      }
      if (event.key === "j" || event.key === "J") {
        setPlaying(false);
        setPlayhead((frame) => Math.max(0, frame - Math.round(fps / 4)));
        return;
      }
      if (event.key === "l" || event.key === "L") {
        setPlaying(false);
        setPlayhead((frame) => frame + Math.round(fps / 4));
        return;
      }
      if (event.key === "k" || event.key === "K") {
        setPlaying((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!project) {
      return;
    }
    if (project.review.lastAgentSeq !== lastAgentSeq.current) {
      lastAgentSeq.current = project.review.lastAgentSeq;
      covered.current = new Set();
      ackSentFor.current = -1;
    }
  }, [project]);

  function onScrubBucket(seconds: number) {
    if (!project) {
      return;
    }
    const endSeconds = timelineEndFrame(project) / project.fps;
    const bucket = Math.floor(seconds);
    covered.current.add(bucket);
    const total = Math.max(1, Math.ceil(endSeconds));
    if (covered.current.size >= total && project.review.lastAgentSeq > project.review.ackSeq) {
      if (ackSentFor.current !== project.review.lastAgentSeq) {
        ackSentFor.current = project.review.lastAgentSeq;
        void commitOps([{ type: "review_ack", payload: { seq: project.review.lastAgentSeq } }]);
      }
    }
  }

  async function sendAgent(text: string) {
    if (!project) {
      return;
    }
    agentAbort.current?.abort();
    const abort = new AbortController();
    agentAbort.current = abort;
    const response = await apiFetch(`/api/v1/edit/projects/${project.id}/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, tier }),
      signal: abort.signal,
    });
    if (response.status === 404) {
      setError(t("edit.errors.agentUnavailable"));
      return;
    }
    if (!response.ok || !response.body) {
      setError(errorMessage(await readJson(response), t("edit.errors.agentFailed")));
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!abort.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      const parsed = consumeSse(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) {
        const record = event as unknown as Record<string, unknown>;
        if (event.type === "tool.started") {
          const touching = Array.isArray(record.touching) ? (record.touching as string[]) : undefined;
          const toolKey = typeof record.toolKey === "string" ? record.toolKey : "";
          emitLock.onToolStarted(touching, {
            jobPending: Boolean(record.jobPending) || /generate_|transcribe|export/.test(toolKey),
          });
        }
        if (event.type === "edit.card" || event.type === "card.updated") {
          const card = (record.card ?? record) as OpCard;
          if (card && (typeof card.id === "string" || card.verb)) {
            setCards((current) => upsertCard(current, card));
          }
          emitLock.onCard();
        }
        if (event.type === "edit.ops" || event.type === "ops.appended") {
          const ops = (record.ops ?? record.applied) as EditOp[] | undefined;
          if (Array.isArray(ops)) {
            setProject((current) => (current ? foldApplied(current, ops) : current));
          }
        }
        if (event.type === "edit.plan") {
          const card = (record.card ?? record) as OpCard;
          if (card && typeof card.id === "string") {
            setCards((current) => [
              ...current.filter((item) => item.id !== card.id),
              { ...card, toolKey: card.toolKey ?? "propose_plan" },
            ]);
          }
        }
      }
    }
    await reloadProject(project.id);
  }

  async function onKeep(cardId: string) {
    if (!project) {
      return;
    }
    await apiFetch(`/api/v1/edit/projects/${project.id}/cards/${cardId}/keep`, { method: "POST" });
    await reloadProject(project.id);
  }

  async function onUndo(cardId: string) {
    if (!project) {
      return;
    }
    await apiFetch(`/api/v1/edit/projects/${project.id}/undo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId }),
    });
    await reloadProject(project.id);
  }

  function onTweak(card: OpCard) {
    const args = card.args ?? { tool: card.toolKey, verb: card.verb, object: card.object };
    setComposerPrefill(typeof args === "string" ? args : JSON.stringify(args));
  }

  async function onCancel(jobId: string) {
    if (!project) {
      return;
    }
    await apiFetch(`/api/v1/edit/projects/${project.id}/jobs/${jobId}/cancel`, { method: "POST" });
    await reloadProject(project.id);
  }

  async function onPlanGo(_card: OpCard) {
    await sendAgent("Go");
  }

  async function onReviewOk() {
    if (!project) {
      return;
    }
    await commitOps([{ type: "review_ack", payload: { seq: project.review.lastAgentSeq } }]);
  }

  async function onPlace(id: string) {
    if (!project) {
      return;
    }
    await apiFetch(`/api/v1/edit/projects/${project.id}/unplaced/${id}/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId: "v1", timelineStartFrame: playhead }),
    });
    await reloadProject(project.id);
  }

  async function onDiscard(id: string) {
    if (!project) {
      return;
    }
    await apiFetch(`/api/v1/edit/projects/${project.id}/unplaced/${id}/discard`, { method: "POST" });
    await reloadProject(project.id);
  }

  async function onExport() {
    if (!project) {
      return;
    }
    setExporting(true);
    setError(null);
    setExportJobId(null);
    const response = await apiFetch(`/api/v1/edit/projects/${project.id}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "h264-1080p" }),
    });
    const payload = await readJson(response);
    if (!response.ok) {
      setExporting(false);
      setError(errorMessage(payload, t("edit.errors.exportBlocked")));
      return;
    }
    const jobId =
      typeof payload.id === "string" ? payload.id : typeof payload.jobId === "string" ? payload.jobId : null;
    setExportJobId(jobId);
    if (!jobId) {
      setExporting(false);
    }
  }

  async function onDownloadExport() {
    if (!project || !exportJobId) {
      return;
    }
    setError(null);
    try {
      const response = await apiFetch(`/api/v1/edit/projects/${project.id}/export/${exportJobId}/file`);
      if (!response.ok) {
        setError(errorMessage(await readJson(response), t("edit.errors.exportNotReady")));
        return;
      }
      if (isElectron()) {
        // apiFetch already wrote the bytes through the native save dialog; a second, browser-style
        // download here would open the save dialog twice.
        return;
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? "export.mp4";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("edit.errors.exportDownload"));
    }
  }

  const reviewOpen = isReviewOpen(project);
  const jobsLive = activeJobs(jobs);
  const spent = turnSpendUsd(cards, jobs);
  const exportJob = exportJobId ? jobs.find((job) => job.id === exportJobId) : undefined;
  const exportReady = exportJob?.status === "succeeded";
  const exportBusy =
    Boolean(exportJobId) && !exportReady && exportJob?.status !== "failed" && exportJob?.status !== "cancelled";

  useEffect(() => {
    if (!exportJobId) {
      return;
    }
    if (exportJob?.status === "succeeded" || exportJob?.status === "failed" || exportJob?.status === "cancelled") {
      setExporting(false);
    }
  }, [exportJob?.status, exportJobId]);

  return (
    <main
      data-mode="edit"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app text-[var(--text)]"
      data-testid="edit-studio"
    >
      {doctor ? <FfmpegSetupNotice doctor={doctor} onDoctor={setDoctor} /> : null}
      <div className="shrink-0 border-b border-[var(--line)] px-4 py-3">
        <ModeHeader
          icon="edit"
          title={project?.name ?? t("edit.title")}
          outcome={t("edit.expectedInputs")}
          actions={
            <>
              <select
                className="select-field"
                value={tier}
                onChange={(event) => setTier(event.target.value)}
                data-testid="edit-tier"
              >
                <option value="draft">{t("edit.tier.draft")}</option>
                <option value="standard">{t("edit.tier.standard")}</option>
                <option value="cinematic">{t("edit.tier.cinematic")}</option>
              </select>
              <span className="chip" data-testid="edit-jobs">
                {t("edit.jobs", { count: jobsLive.length > 0 ? `~${jobsLive.length}` : "0" })}
              </span>
              <span className="chip">{t("edit.turnMeter", { spent: formatUsd(spent), cap: formatUsd(spendCap) })}</span>
              <button type="button" className="btn btn-ghost px-2 py-1 text-xs" data-testid="edit-parity-check">
                {t("edit.parity")}
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-pill px-4"
                data-testid="edit-export"
                disabled={!project || !reviewOpen || exporting}
                onClick={() => void onExport()}
              >
                {exporting ? <WorkingStatus label={t("edit.export")} /> : t("edit.export")}
              </button>
            </>
          }
        />
      </div>
      {exporting || exportBusy ? (
        <p className="px-4" data-testid="edit-export-progress">
          <WorkingStatus label={t("edit.exporting")} />
        </p>
      ) : null}
      {exportReady ? (
        <button
          type="button"
          className="px-4 text-left text-xs underline"
          data-testid="edit-export-download"
          onClick={() => void onDownloadExport()}
        >
          {t("edit.downloadExport")}
        </button>
      ) : null}
      {error ? (
        <p className="px-4 py-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {!project ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6" data-testid="edit-project-list">
            <h2 className="font-heading text-xl">{t("edit.projects")}</h2>
            <div className="mt-4 flex flex-col gap-2">
              <select
                className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
                value={starterId}
                onChange={(event) => setStarterId(event.target.value)}
                data-testid="edit-starter"
              >
                {STARTER_PROJECTS.map((starter) => (
                  <option key={starter.id} value={starter.id}>
                    {starter.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-[var(--text-2)]" data-testid="edit-starter-description">
                {STARTER_PROJECTS.find((starter) => starter.id === starterId)?.description ?? ""}
              </p>
              <div className="flex gap-2">
                <input
                  className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  data-testid="edit-project-name"
                />
                <button
                  type="button"
                  className="btn btn-primary px-3 py-2 text-sm"
                  data-testid="edit-new-project"
                  onClick={() => void onNewProject()}
                >
                  {t("edit.newProject")}
                </button>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              {items.map((item, index) => (
                <li key={item.id} className="enter-rise" style={{ "--i": index } as CSSProperties}>
                  <button
                    type="button"
                    className="card-live w-full px-3 py-2 text-left text-sm"
                    onClick={() => void reloadProject(item.id)}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex min-h-0 w-[320px] flex-col border-l border-[var(--line)]">
            <div className="min-h-0 flex-1" data-testid="edit-preview" />
            <div className="h-24 border-t border-[var(--line)]" data-testid="edit-timeline" />
          </div>
          <aside className="w-[280px] border-l border-[var(--line)]" data-testid="edit-agent-panel">
            <div className="flex flex-col items-center px-4 py-8 text-center">
              <ModeIllustration mode="edit" />
              <p className="mt-4 text-xs text-[var(--text-3)]">{t("edit.openProjectHint")}</p>
            </div>
          </aside>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <nav className="flex w-[112px] shrink-0 flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--surface)] py-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept="video/*,image/*,audio/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  void onImportFile(file);
                }
              }}
            />
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`mx-1.5 mb-1 rounded-md px-2 py-1.5 text-left text-sm ${
                  tool === item.id
                    ? "bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)]"
                    : "hover:bg-[var(--line)]/40"
                }`}
                data-testid={
                  item.id === "upload" ? "edit-import" : item.id === "generate" ? "edit-generate-tab" : undefined
                }
                onClick={() => {
                  if (item.id === "upload") {
                    void onImportClick();
                  }
                  setTool(item.id);
                }}
              >
                {t(`edit.tools.${item.id}`)}
              </button>
            ))}
          </nav>
          {tool !== "upload" ? (
            <aside className="flex min-h-0 w-[260px] min-w-[180px] shrink flex-col overflow-hidden border-r border-[var(--line)] bg-[var(--surface)] min-[1600px]:w-[300px] min-[2400px]:w-[340px]">
              {tool === "generate" ? (
                <EditGenerateTab
                  project={project}
                  playhead={playhead}
                  stillClip={imageClipAt(project, playhead)}
                  models={models}
                  imageModels={imageModels}
                  needsKey={!hasKey}
                  gatewayName={gatewayName}
                  tier={tier}
                  onTierChange={setTier}
                  onSubmitted={() => void reloadProject(project.id)}
                  onAgentPrompt={(text) => void sendAgent(text)}
                />
              ) : tool === "recipes" ? (
                <EditRecipesPanel onRun={(recipeId) => void sendAgent(`Run recipe ${recipeId}`)} />
              ) : (
                <p className="p-3 text-xs text-[var(--text-3)]">
                  {tool === "captions" ? (
                    <Link href="/settings" className="underline">
                      {t("edit.tools.captions")}
                    </Link>
                  ) : (
                    t("edit.phaseLater", { label: t(`edit.tools.${tool}`) })
                  )}
                </p>
              )}
            </aside>
          ) : null}
          <div className="flex min-h-0 min-w-[200px] flex-1 flex-col overflow-hidden">
            <EditPreview
              project={project}
              playhead={playhead}
              playing={playing}
              onPlayhead={setPlayhead}
              onPlaying={setPlaying}
              onScrubBucket={onScrubBucket}
            />
            <EditTimeline
              project={project}
              playhead={playhead}
              selectedClipId={selectedClipId}
              lockedClipIds={emitLock.lockedClipIds()}
              jobs={jobs}
              onPlayhead={setPlayhead}
              onSelect={setSelectedClipId}
              onMove={(clipId, trackId, timelineStartFrame) => {
                void commitOps([{ type: "move_clip", payload: { clipId, trackId, timelineStartFrame } }]);
              }}
              onTrim={(clipId, inFrame, durationFrames) => {
                void commitOps([{ type: "trim_clip", payload: { clipId, inFrame, durationFrames } }]);
              }}
            />
            <p className="px-3 py-1 text-xs text-[var(--text-3)]" data-testid="edit-ops-count">
              ops {opsPosted}
            </p>
          </div>
          <EditAgentPanel
            project={project}
            cards={cards}
            jobs={jobs}
            unplaced={unplaced}
            spendCap={spendCap}
            emitLockActive={emitLock.isActive()}
            composerPrefill={composerPrefill}
            onComposerPrefill={setComposerPrefill}
            onSend={(text) => void sendAgent(text)}
            onKeep={(id) => void onKeep(id)}
            onUndo={(id) => void onUndo(id)}
            onTweak={onTweak}
            onCancel={(id) => void onCancel(id)}
            onPlanGo={(card) => void onPlanGo(card)}
            onReviewOk={() => void onReviewOk()}
            onPlace={(id) => void onPlace(id)}
            onDiscard={(id) => void onDiscard(id)}
          />
        </div>
      )}
    </main>
  );
}

function upsertCard(current: OpCard[], card: OpCard): OpCard[] {
  const id = card.id || crypto.randomUUID();
  const next: OpCard = {
    ...card,
    id,
    verb: card.verb || "Edit",
    object: card.object || "",
    status: card.status || "proposed",
  };
  return [...current.filter((item) => item.id !== id), next];
}

function mergeCards(current: OpCard[], incoming: OpCard[]): OpCard[] {
  if (incoming.length === 0) {
    return current;
  }
  const map = new Map<string, OpCard>();
  for (const card of current) {
    map.set(card.id, card);
  }
  for (const card of incoming) {
    map.set(card.id, card);
  }
  return [...map.values()];
}

function projectAspectFromStarter(starterId: string): "16:9" | "9:16" | "1:1" {
  const starter = STARTER_PROJECTS.find((item) => item.id === starterId);
  return starter?.aspect ?? "16:9";
}
